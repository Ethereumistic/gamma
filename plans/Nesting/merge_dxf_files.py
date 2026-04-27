"""
merge_dxf_files.py
------------------
Merges multiple .dxf files into a grid layout.
Uses ezdxf's xref / simple entity copy approach — no Importer.

Requirements:
    pip install ezdxf

Usage:
    python merge_dxf_files.py
"""

import os
import math
import ezdxf
from ezdxf import bbox as ezdxf_bbox

# ── Configuration ──────────────────────────────────────────────────────────────

INPUT_FOLDER = "."
OUTPUT_FILE  = "merged_output.dxf"
GAP          = 50
COLUMNS      = 0
DXF_VERSION  = "R2010"

LABEL_HEIGHT   = 60
LABEL_LAYER    = "LABELS"

# ───────────────────────────────────────────────────────────────────────────────


def extract_label(filename):
    name  = os.path.splitext(os.path.basename(filename))[0]
    parts = name.split("-")
    return f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else parts[0]


def get_bounding_box(doc):
    msp = doc.modelspace()
    try:
        result = ezdxf_bbox.extents(msp, fast=True)
        if result.has_data:
            return (result.extmin.x, result.extmin.y,
                    result.extmax.x, result.extmax.y)
    except Exception:
        pass
    xs, ys = [], []
    for e in msp:
        try:
            t = e.dxftype()
            if t == "LINE":
                xs += [e.dxf.start.x, e.dxf.end.x]
                ys += [e.dxf.start.y, e.dxf.end.y]
            elif t in ("CIRCLE", "ARC"):
                r = e.dxf.radius
                xs += [e.dxf.center.x - r, e.dxf.center.x + r]
                ys += [e.dxf.center.y - r, e.dxf.center.y + r]
            elif t == "LWPOLYLINE":
                pts = list(e.get_points())
                xs += [p[0] for p in pts]
                ys += [p[1] for p in pts]
        except Exception:
            pass
    if xs and ys:
        return min(xs), min(ys), max(xs), max(ys)
    return 0, 0, 0, 0


def copy_entity_to_msp(entity, out_msp, out_doc, offset_x, offset_y):
    """Recreate a single entity in the output modelspace, shifted by offset."""
    t = entity.dxftype()
    try:
        if t == "LINE":
            out_msp.add_line(
                start=(entity.dxf.start.x + offset_x, entity.dxf.start.y + offset_y),
                end  =(entity.dxf.end.x   + offset_x, entity.dxf.end.y   + offset_y),
                dxfattribs={"layer": entity.dxf.layer}
            )
        elif t == "CIRCLE":
            out_msp.add_circle(
                center=(entity.dxf.center.x + offset_x, entity.dxf.center.y + offset_y),
                radius=entity.dxf.radius,
                dxfattribs={"layer": entity.dxf.layer}
            )
        elif t == "ARC":
            out_msp.add_arc(
                center     =(entity.dxf.center.x + offset_x, entity.dxf.center.y + offset_y),
                radius     =entity.dxf.radius,
                start_angle=entity.dxf.start_angle,
                end_angle  =entity.dxf.end_angle,
                dxfattribs ={"layer": entity.dxf.layer}
            )
        elif t == "LWPOLYLINE":
            pts = [(p[0] + offset_x, p[1] + offset_y) for p in entity.get_points()]
            out_msp.add_lwpolyline(
                pts,
                dxfattribs={"layer": entity.dxf.layer,
                             "closed": entity.closed}
            )
        elif t == "POLYLINE":
            pts = [(v.dxf.location.x + offset_x,
                    v.dxf.location.y + offset_y,
                    v.dxf.location.z) for v in entity.vertices]
            out_msp.add_polyline3d(pts, dxfattribs={"layer": entity.dxf.layer})
        elif t == "SPLINE":
            pts = [(p[0] + offset_x, p[1] + offset_y, p[2]) for p in entity.fit_points]
            if len(pts) >= 2:
                out_msp.add_spline(fit_points=pts, dxfattribs={"layer": entity.dxf.layer})
        elif t == "TEXT":
            out_msp.add_text(
                entity.dxf.text,
                dxfattribs={
                    "layer":  entity.dxf.layer,
                    "height": entity.dxf.height,
                    "insert": (entity.dxf.insert.x + offset_x,
                               entity.dxf.insert.y + offset_y),
                }
            )
        elif t == "MTEXT":
            mt = out_msp.add_mtext(entity.text, dxfattribs={"layer": entity.dxf.layer})
            mt.dxf.insert = (entity.dxf.insert.x + offset_x,
                             entity.dxf.insert.y + offset_y)
            mt.dxf.char_height = entity.dxf.char_height
        elif t == "INSERT":
            # Block reference — copy block def then insert
            bname = entity.dxf.name
            if bname in entity.doc.blocks and bname not in out_doc.blocks:
                src_blk = entity.doc.blocks[bname]
                new_blk = out_doc.blocks.new(name=bname)
                for blk_entity in src_blk:
                    try:
                        copy_entity_to_msp(blk_entity, new_blk, out_doc, 0, 0)
                    except Exception:
                        pass
            ins = entity.dxf.insert
            out_msp.add_blockref(
                bname,
                insert=(ins.x + offset_x, ins.y + offset_y),
                dxfattribs={"layer": entity.dxf.layer}
            )
        elif t == "HATCH":
            hatch = out_msp.add_hatch(
                color=entity.dxf.solid_fill,
                dxfattribs={"layer": entity.dxf.layer}
            )
            for path in entity.paths:
                if hasattr(path, 'vertices'):
                    pts = [(v[0] + offset_x, v[1] + offset_y) for v in path.vertices]
                    hatch.paths.add_polyline_path(pts)
        elif t == "ELLIPSE":
            out_msp.add_ellipse(
                center      =(entity.dxf.center.x + offset_x, entity.dxf.center.y + offset_y),
                major_axis  =entity.dxf.major_axis,
                ratio       =entity.dxf.ratio,
                start_param =entity.dxf.start_param,
                end_param   =entity.dxf.end_param,
                dxfattribs  ={"layer": entity.dxf.layer}
            )
        elif t == "POINT":
            out_msp.add_point(
                location=(entity.dxf.location.x + offset_x, entity.dxf.location.y + offset_y),
                dxfattribs={"layer": entity.dxf.layer}
            )
        elif t == "SOLID":
            pts = [(entity.dxf.vtx0.x + offset_x, entity.dxf.vtx0.y + offset_y),
                   (entity.dxf.vtx1.x + offset_x, entity.dxf.vtx1.y + offset_y),
                   (entity.dxf.vtx2.x + offset_x, entity.dxf.vtx2.y + offset_y),
                   (entity.dxf.vtx3.x + offset_x, entity.dxf.vtx3.y + offset_y)]
            out_msp.add_solid(pts, dxfattribs={"layer": entity.dxf.layer})
        elif t == "DIMENSION":
            pass  # skip dimensions — they reference complex style tables
        else:
            pass  # skip unsupported types silently
    except Exception:
        pass  # skip any individual entity that fails


def ensure_layer(out_doc, layer_name, src_doc):
    """Copy a layer definition from source if it doesn't exist in output."""
    if layer_name not in [l.dxf.name for l in out_doc.layers]:
        try:
            src_layer = src_doc.layers.get(layer_name)
            out_doc.layers.new(name=layer_name, dxfattribs={
                "color": src_layer.dxf.color,
                "linetype": "Continuous",
            })
        except Exception:
            try:
                out_doc.layers.new(name=layer_name)
            except Exception:
                pass


def merge_dxf_files(input_folder, output_file, gap, columns, dxf_version):
    dxf_files = sorted([
        os.path.join(input_folder, f)
        for f in os.listdir(input_folder)
        if f.lower().endswith(".dxf") and f != output_file
    ])

    if not dxf_files:
        print("No .dxf files found in:", input_folder)
        return

    print(f"Found {len(dxf_files)} DXF files. Merging...\n")

    n    = len(dxf_files)
    cols = columns if columns > 0 else math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    print(f"Grid layout: {cols} columns x {rows} rows\n")

    # Pass 1: load + measure
    docs, bboxes = [], []
    for path in dxf_files:
        try:
            doc = ezdxf.readfile(path)
            bb  = get_bounding_box(doc)
            docs.append(doc)
            bboxes.append(bb)
            w, h = bb[2] - bb[0], bb[3] - bb[1]
            print(f"  {os.path.basename(path):40s}  {w:.0f} x {h:.0f}  label: '{extract_label(path)}'")
        except Exception as ex:
            print(f"  WARNING: Could not read {path}: {ex}")
            docs.append(None)
            bboxes.append((0, 0, 0, 0))

    # Grid geometry
    col_widths  = [0.0] * cols
    row_heights = [0.0] * rows
    for idx, bb in enumerate(bboxes):
        col_widths[idx % cols]   = max(col_widths[idx % cols],   bb[2] - bb[0])
        row_heights[idx // cols] = max(row_heights[idx // cols],  bb[3] - bb[1])

    col_offsets = [sum(col_widths[:i])  + i * gap for i in range(cols)]
    row_offsets = [sum(row_heights[:i]) + i * gap for i in range(rows)]

    # Create clean output doc
    out_doc = ezdxf.new(dxf_version)
    out_msp = out_doc.modelspace()
    out_doc.layers.new(name=LABEL_LAYER, dxfattribs={"color": 1})  # red labels

    # Pass 2: copy entities
    print("\nImporting...")
    success = 0
    for idx, (doc, bb) in enumerate(zip(docs, bboxes)):
        if doc is None:
            continue

        c, r     = idx % cols, idx // cols
        offset_x = col_offsets[c] - bb[0]
        offset_y = row_offsets[r] - bb[1]
        fname    = os.path.basename(dxf_files[idx])
        label    = extract_label(dxf_files[idx])

        # Copy layer definitions from source
        for layer in doc.layers:
            ensure_layer(out_doc, layer.dxf.name, doc)

        # Copy all entities
        entity_count = 0
        for entity in doc.modelspace():
            copy_entity_to_msp(entity, out_msp, out_doc, offset_x, offset_y)
            entity_count += 1

        # Add label at center
        min_x, min_y, max_x, max_y = bb
        cx = (min_x + max_x) / 2 + offset_x
        cy = (min_y + max_y) / 2 + offset_y
        out_msp.add_text(
            label,
            dxfattribs={
                "layer":       LABEL_LAYER,
                "height":      LABEL_HEIGHT,
                "insert":      (cx, cy),
                "halign":      1,
                "align_point": (cx, cy),
            }
        )

        print(f"  OK  {fname}  ({entity_count} entities)")
        success += 1

    # Set extents for AutoCAD
    total_w = sum(col_widths)  + gap * (cols - 1)
    total_h = sum(row_heights) + gap * (rows - 1)
    out_doc.header['$EXTMIN'] = (0, 0, 0)
    out_doc.header['$EXTMAX'] = (total_w, total_h, 0)
    out_doc.header['$LIMMIN'] = (0, 0)
    out_doc.header['$LIMMAX'] = (total_w, total_h)
    out_doc.header['$INSUNITS'] = 4  # mm

    try:
        vp = out_doc.viewports.get('*Active')
        if vp:
            vp[0].dxf.center = (total_w / 2, total_h / 2)
            vp[0].dxf.height = total_h * 1.1
    except Exception:
        pass

    out_path = os.path.join(input_folder, output_file)
    out_doc.saveas(out_path)

    print(f"\nImported {success}/{len(dxf_files)} files successfully.")
    print(f"Saved:             {out_path}")
    print(f"Total canvas size: {total_w:.0f} x {total_h:.0f} units")
    print("Done!")


if __name__ == "__main__":
    merge_dxf_files(INPUT_FOLDER, OUTPUT_FILE, GAP, COLUMNS, DXF_VERSION)