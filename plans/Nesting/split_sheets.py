"""
split_sheets.py  v3
--------------------
Splits a multi-sheet DXF into one DXF per sheet.

Root causes fixed vs v1/v2:
  1. Labels were on layer SHEETS (not LABELS) — now auto-detected by height
  2. deepcopy + add_entity across documents silently drops entities —
     now uses ezdxf's importer / entity recreation approach
  3. Only layers actually used in each sheet are written to that file

Usage:
    python split_sheets.py input.dxf [output_folder]
"""

import sys
import copy
from pathlib import Path
from collections import defaultdict

import ezdxf
from ezdxf.math import Vec3

# ── CONFIGURATION ─────────────────────────────────────────────────────────────

SHEET_W      = 1250.0   # sheet width  in drawing units
SHEET_H      = 3200.0   # sheet height in drawing units
SIZE_TOL     = 30.0     # tolerance for matching sheet size

# The sheet-name label sits ABOVE the sheet top edge.
# We look within this band above the top edge.
LABEL_SEARCH_ABOVE = 600.0

# Minimum text height to be considered a sheet name label.
# From diagnosis: label height ~249, "1 put" height ~126, part labels ~60-64.
# Set just above the "1 put" text to avoid grabbing that instead.
LABEL_MIN_HEIGHT = 150.0

# Layer containing the sheet border rectangles
SHEET_LAYER  = "SHEETS"

# Small expand on sheet bbox to catch entities sitting exactly on the border
BBOX_EXPAND  = 5.0

# ── ENTITY BBOX ───────────────────────────────────────────────────────────────

def get_bbox(e):
    """Return (x1,y1,x2,y2) for an entity, or None."""
    t = e.dxftype()
    try:
        if t == "LINE":
            sx,sy = e.dxf.start.x, e.dxf.start.y
            ex,ey = e.dxf.end.x,   e.dxf.end.y
            return min(sx,ex), min(sy,ey), max(sx,ex), max(sy,ey)
        elif t == "LWPOLYLINE":
            pts = list(e.get_points())
            if not pts: return None
            xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
            return min(xs),min(ys),max(xs),max(ys)
        elif t == "POLYLINE":
            verts = list(e.vertices)
            if not verts: return None
            xs=[v.dxf.location.x for v in verts]
            ys=[v.dxf.location.y for v in verts]
            return min(xs),min(ys),max(xs),max(ys)
        elif t == "TEXT":
            x,y = e.dxf.insert.x, e.dxf.insert.y
            return x, y, x, y   # point only — width estimated via h*20 caused bleed
        elif t == "MTEXT":
            x,y = e.dxf.insert.x, e.dxf.insert.y
            return x, y, x, y   # point only
        elif t == "CIRCLE":
            cx,cy,r = e.dxf.center.x, e.dxf.center.y, e.dxf.radius
            return cx-r,cy-r,cx+r,cy+r
        elif t == "ARC":
            cx,cy,r = e.dxf.center.x, e.dxf.center.y, e.dxf.radius
            return cx-r,cy-r,cx+r,cy+r
        elif t == "ELLIPSE":
            cx,cy = e.dxf.center.x, e.dxf.center.y
            import math
            mx = e.dxf.major_axis
            r = math.hypot(mx.x, mx.y)
            return cx-r,cy-r,cx+r,cy+r
        elif t == "SPLINE":
            pts = list(e.control_points)
            if not pts: return None
            xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
            return min(xs),min(ys),max(xs),max(ys)
        elif t == "HATCH":
            axs,ays=[],[]
            for path in e.paths:
                if hasattr(path,"vertices"):
                    for v in path.vertices: axs.append(v[0]); ays.append(v[1])
            if axs: return min(axs),min(ays),max(axs),max(ays)
        elif t in ("SOLID","TRACE"):
            pts=[e.dxf.vtx0,e.dxf.vtx1,e.dxf.vtx2,e.dxf.vtx3]
            xs=[p.x for p in pts]; ys=[p.y for p in pts]
            return min(xs),min(ys),max(xs),max(ys)
        elif t == "POINT":
            return e.dxf.location.x, e.dxf.location.y, e.dxf.location.x, e.dxf.location.y
        elif t == "INSERT":
            x,y = e.dxf.insert.x, e.dxf.insert.y
            return x,y,x,y
        elif t == "DIMENSION":
            if e.dxf.hasattr("defpoint"):
                x,y = e.dxf.defpoint.x, e.dxf.defpoint.y
                return x,y,x,y
    except Exception:
        pass
    return None


def overlaps(eb, sb):
    return eb[0]<=sb[2] and eb[2]>=sb[0] and eb[1]<=sb[3] and eb[3]>=sb[1]


# ── TRANSLATION ───────────────────────────────────────────────────────────────

def translate(e, dx, dy):
    """Translate entity in-place by (dx, dy)."""
    t = e.dxftype()
    try:
        if t == "LINE":
            s,en = e.dxf.start, e.dxf.end
            e.dxf.start = Vec3(s.x+dx,  s.y+dy,  s.z)
            e.dxf.end   = Vec3(en.x+dx, en.y+dy, en.z)
        elif t == "LWPOLYLINE":
            pts = list(e.get_points(format="xyseb"))
            e.set_points([(p[0]+dx,p[1]+dy,p[2],p[3],p[4]) for p in pts], format="xyseb")
        elif t in ("TEXT","MTEXT"):
            ins = e.dxf.insert
            e.dxf.insert = Vec3(ins.x+dx, ins.y+dy, ins.z)
            if t == "TEXT" and e.dxf.hasattr("align_point"):
                ap = e.dxf.align_point
                e.dxf.align_point = Vec3(ap.x+dx, ap.y+dy, ap.z)
        elif t in ("CIRCLE","ARC","ELLIPSE"):
            c = e.dxf.center
            e.dxf.center = Vec3(c.x+dx, c.y+dy, c.z)
        elif t == "INSERT":
            ins = e.dxf.insert
            e.dxf.insert = Vec3(ins.x+dx, ins.y+dy, ins.z)
        elif t == "SPLINE":
            e.control_points = [Vec3(p[0]+dx,p[1]+dy,p[2] if len(p)>2 else 0)
                                 for p in e.control_points]
            if e.fit_points:
                e.fit_points = [Vec3(p[0]+dx,p[1]+dy,p[2] if len(p)>2 else 0)
                                 for p in e.fit_points]
        elif t == "HATCH":
            for path in e.paths:
                if hasattr(path,"vertices"):
                    path.vertices=[(v[0]+dx,v[1]+dy) for v in path.vertices]
        elif t in ("SOLID","TRACE"):
            for attr in ("vtx0","vtx1","vtx2","vtx3"):
                v=getattr(e.dxf,attr)
                setattr(e.dxf,attr,Vec3(v.x+dx,v.y+dy,v.z))
        elif t == "POLYLINE":
            for v in e.vertices:
                loc=v.dxf.location
                v.dxf.location=Vec3(loc.x+dx,loc.y+dy,loc.z)
        elif t == "POINT":
            loc=e.dxf.location
            e.dxf.location=Vec3(loc.x+dx,loc.y+dy,loc.z)
        elif t == "DIMENSION":
            for attr in ("defpoint","text_midpoint","defpoint2","defpoint3","defpoint4","defpoint5"):
                if e.dxf.hasattr(attr):
                    p=getattr(e.dxf,attr)
                    setattr(e.dxf,attr,Vec3(p.x+dx,p.y+dy,p.z))
    except Exception:
        pass


# ── WRITE ENTITY INTO NEW DOC ─────────────────────────────────────────────────

def add_line(msp, e, dx, dy):
    s = e.dxf.start; en = e.dxf.end
    new = msp.add_line(
        (s.x+dx, s.y+dy), (en.x+dx, en.y+dy),
        dxfattribs={"layer": e.dxf.layer,
                    "linetype": e.dxf.linetype if e.dxf.hasattr("linetype") else "Continuous",
                    "color": e.dxf.color if e.dxf.hasattr("color") else 256})

def add_lwpolyline(msp, e, dx, dy):
    pts = list(e.get_points(format="xyseb"))
    new_pts = [(p[0]+dx, p[1]+dy, p[2], p[3], p[4]) for p in pts]
    attribs = {"layer": e.dxf.layer,
               "closed": bool(e.dxf.flags & 1)}
    if e.dxf.hasattr("color"):    attribs["color"]    = e.dxf.color
    if e.dxf.hasattr("linetype"): attribs["linetype"] = e.dxf.linetype
    new = msp.add_lwpolyline(new_pts, format="xyseb", dxfattribs=attribs)

def add_text(msp, e, dx, dy):
    ins = e.dxf.insert
    attribs = {
        "layer":  e.dxf.layer,
        "height": e.dxf.height if e.dxf.hasattr("height") else 2.5,
        "insert": Vec3(ins.x+dx, ins.y+dy, ins.z),
    }
    for a in ("style","rotation","width","oblique","color","halign","valign"):
        if e.dxf.hasattr(a): attribs[a] = getattr(e.dxf, a)
    new = msp.add_text(e.dxf.text, dxfattribs=attribs)
    if e.dxf.hasattr("align_point"):
        ap = e.dxf.align_point
        new.dxf.align_point = Vec3(ap.x+dx, ap.y+dy, ap.z)

def add_circle(msp, e, dx, dy):
    c = e.dxf.center
    attribs = {"layer": e.dxf.layer}
    if e.dxf.hasattr("color"): attribs["color"] = e.dxf.color
    msp.add_circle((c.x+dx, c.y+dy), e.dxf.radius, dxfattribs=attribs)

def add_arc(msp, e, dx, dy):
    c = e.dxf.center
    attribs = {"layer": e.dxf.layer}
    if e.dxf.hasattr("color"): attribs["color"] = e.dxf.color
    msp.add_arc((c.x+dx, c.y+dy), e.dxf.radius,
                e.dxf.start_angle, e.dxf.end_angle, dxfattribs=attribs)

def recreate_entity(msp, e, dx, dy):
    """Recreate entity in msp with translation applied. Returns True on success."""
    t = e.dxftype()
    try:
        if t == "LINE":
            add_line(msp, e, dx, dy); return True
        elif t == "LWPOLYLINE":
            add_lwpolyline(msp, e, dx, dy); return True
        elif t == "TEXT":
            add_text(msp, e, dx, dy); return True
        elif t == "CIRCLE":
            add_circle(msp, e, dx, dy); return True
        elif t == "ARC":
            add_arc(msp, e, dx, dy); return True
        elif t == "MTEXT":
            ins = e.dxf.insert
            attribs = {"layer": e.dxf.layer,
                       "char_height": e.dxf.char_height if e.dxf.hasattr("char_height") else 2.5,
                       "insert": Vec3(ins.x+dx, ins.y+dy, 0)}
            if e.dxf.hasattr("color"): attribs["color"] = e.dxf.color
            msp.add_mtext(e.plain_mtext(), dxfattribs=attribs); return True
        elif t == "POLYLINE":
            verts = list(e.vertices)
            pts = [(v.dxf.location.x+dx, v.dxf.location.y+dy) for v in verts]
            attribs = {"layer": e.dxf.layer}
            msp.add_polyline2d(pts, dxfattribs=attribs); return True
        elif t == "SPLINE":
            pts = [(p[0]+dx, p[1]+dy, p[2] if len(p)>2 else 0)
                   for p in e.control_points]
            attribs = {"layer": e.dxf.layer,
                       "degree": e.dxf.degree if e.dxf.hasattr("degree") else 3}
            msp.add_spline(control_points=pts, dxfattribs=attribs); return True
        elif t == "HATCH":
            # rebuild hatch with boundary paths
            attribs = {"layer": e.dxf.layer}
            if e.dxf.hasattr("color"): attribs["color"] = e.dxf.color
            hatch = msp.add_hatch(color=e.dxf.color if e.dxf.hasattr("color") else 7,
                                  dxfattribs=attribs)
            for path in e.paths:
                if hasattr(path, "vertices") and path.vertices:
                    pts = [(v[0]+dx, v[1]+dy) for v in path.vertices]
                    hatch.paths.add_polyline_path(pts, is_closed=True)
            return True
        elif t in ("SOLID","TRACE"):
            pts = [(e.dxf.vtx0.x+dx, e.dxf.vtx0.y+dy),
                   (e.dxf.vtx1.x+dx, e.dxf.vtx1.y+dy),
                   (e.dxf.vtx2.x+dx, e.dxf.vtx2.y+dy),
                   (e.dxf.vtx3.x+dx, e.dxf.vtx3.y+dy)]
            attribs = {"layer": e.dxf.layer}
            msp.add_solid(pts, dxfattribs=attribs); return True
    except Exception as err:
        pass
    return False


# ── MAIN ──────────────────────────────────────────────────────────────────────

def split_dxf(input_path, output_dir=None):
    input_path = Path(input_path)
    if output_dir is None:
        output_dir = input_path.parent
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading {input_path} …")
    doc = ezdxf.readfile(str(input_path))
    msp = doc.modelspace()
    all_entities = list(msp)

    src_layers = {layer.dxf.name: layer for layer in doc.layers}

    # ── find sheet outlines ───────────────────────────────────────────────────
    print("Finding sheet boundaries …")
    sheet_bboxes = []
    for e in all_entities:
        if e.dxftype() != "LWPOLYLINE": continue
        if SHEET_LAYER and e.dxf.layer != SHEET_LAYER: continue
        pts = list(e.get_points())
        if len(pts) < 4: continue
        xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
        w=max(xs)-min(xs); h=max(ys)-min(ys)
        if ((abs(w-SHEET_W)<SIZE_TOL and abs(h-SHEET_H)<SIZE_TOL) or
            (abs(w-SHEET_H)<SIZE_TOL and abs(h-SHEET_W)<SIZE_TOL)):
            sheet_bboxes.append((min(xs),min(ys),max(xs),max(ys)))

    if not sheet_bboxes:
        print(f"ERROR: No sheet rectangles found. Check SHEET_LAYER='{SHEET_LAYER}' "
              f"and SHEET_W={SHEET_W} / SHEET_H={SHEET_H}")
        sys.exit(1)

    sheet_bboxes.sort(key=lambda b: b[0])
    print(f"  {len(sheet_bboxes)} sheets found.\n")

    # ── pre-compute entity bboxes ─────────────────────────────────────────────
    entity_data = []  # (entity, expanded_bbox)
    for e in all_entities:
        bb = get_bbox(e)
        if bb is not None:
            entity_data.append((e, (bb[0]-BBOX_EXPAND, bb[1]-BBOX_EXPAND,
                                     bb[2]+BBOX_EXPAND, bb[3]+BBOX_EXPAND)))

    print(f"  {len(entity_data)} locatable entities.\n")

    # ── process each sheet ────────────────────────────────────────────────────
    used_labels = {}

    for sbbox in sheet_bboxes:
        sx1, sy1, sx2, sy2 = sbbox
        # Two collection zones:
        # 1. The sheet itself (with small expand on all sides)
        sheet_zone = (sx1-BBOX_EXPAND, sy1-BBOX_EXPAND, sx2+BBOX_EXPAND, sy2+BBOX_EXPAND)
        # 2. The label band directly above — X is clamped tightly to THIS sheet only
        label_zone = (sx1-BBOX_EXPAND, sy2-BBOX_EXPAND, sx2+BBOX_EXPAND, sy2+LABEL_SEARCH_ABOVE)

        # ── find label: TEXT on SHEET_LAYER above the sheet, tallest wins ────
        label = None
        best_h = -1
        for e in all_entities:
            if e.dxftype() != "TEXT": continue
            if e.dxf.layer != SHEET_LAYER: continue
            try:
                ix, iy = e.dxf.insert.x, e.dxf.insert.y
                h      = e.dxf.height if e.dxf.hasattr("height") else 0
                text   = e.dxf.text.strip()
            except Exception:
                continue
            if not text: continue
            if h < LABEL_MIN_HEIGHT: continue          # skip "1 put", part labels
            if ix < sx1-SIZE_TOL or ix > sx2+SIZE_TOL: continue   # wrong X
            if iy < sy2-SIZE_TOL: continue             # must be at/above sheet top
            if iy > sy2+LABEL_SEARCH_ABOVE: continue   # not too far above
            if h > best_h:
                best_h = h; label = text

        if label is None:
            label = f"sheet_{len(used_labels)+1}"
            print(f"  WARNING: no label above sheet at ({sx1:.0f},{sy1:.0f}) → '{label}'")

        # sanitise filename
        bad = r'<>:"/\|?*' + "\x00"
        label = "".join(c for c in label if c not in bad).strip() or "unnamed"
        if label in used_labels:
            used_labels[label] += 1
            label = f"{label}_{used_labels[label]}"
        else:
            used_labels[label] = 1

        # ── collect entities for this sheet ──────────────────────────────────
        # TEXT/MTEXT: always use raw insert POINT so fake-width bbox never
        # bleeds into a neighbouring sheet (left, right, or above).
        # Other entities: use bbox overlap against the sheet interior.
        collected = []
        seen_handles = set()

        for e, eb in entity_data:
            handle = e.dxf.handle
            if handle in seen_handles:
                continue

            if e.dxftype() in ('TEXT', 'MTEXT'):
                # Use insert point — covers both inside the sheet and above it
                try:
                    ix = e.dxf.insert.x
                    iy = e.dxf.insert.y
                except Exception:
                    continue
                if (sx1 - BBOX_EXPAND <= ix <= sx2 + BBOX_EXPAND and
                        sy1 - BBOX_EXPAND <= iy <= sy2 + LABEL_SEARCH_ABOVE):
                    collected.append(e)
                    seen_handles.add(handle)
            else:
                # Non-text: bbox overlap with sheet interior
                if overlaps(eb, sheet_zone):
                    collected.append(e)
                    seen_handles.add(handle)
        used_layers = {e.dxf.layer for e in collected if e.dxf.hasattr("layer")}

        # ── build output document ─────────────────────────────────────────────
        new_doc = ezdxf.new(doc.dxfversion)
        new_msp = new_doc.modelspace()

        # copy only used layer definitions
        for lname in used_layers:
            if lname == "0" or lname in new_doc.layers: continue
            new_layer = new_doc.layers.new(lname)
            if lname in src_layers:
                sl = src_layers[lname]
                for attr in ("color","linetype","lineweight","plot",
                             "locked","frozen","true_color","transparency"):
                    try:
                        if sl.dxf.hasattr(attr):
                            setattr(new_layer.dxf, attr, getattr(sl.dxf, attr))
                    except Exception:
                        pass

        dx = -sx1
        dy = -sy1

        ok = fail = 0
        for e in collected:
            if recreate_entity(new_msp, e, dx, dy):
                ok += 1
            else:
                fail += 1

        out_path = output_dir / f"{label}.dxf"
        new_doc.saveas(str(out_path))

        note = f" ({fail} skipped)" if fail else ""
        print(f"  [{label:>4s}]  {ok} entities{note}  "
              f"layers={sorted(used_layers)}  →  {out_path.name}")

    print(f"\nDone!  {len(sheet_bboxes)} files written to {output_dir}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python split_sheets.py input.dxf [output_folder]")
        sys.exit(1)
    split_dxf(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)