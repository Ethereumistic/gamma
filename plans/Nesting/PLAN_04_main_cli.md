# PLAN 04 — Main Pipeline, CLI & Packing Report

## `main.py`

```python
# main.py
"""
ACM Sheet Metal Auto-Packer
Usage:
    python main.py <input_dir> [--output <output_dir>] [--verbose]

Input:
    A directory containing .dxf part files named:
        [name]_[DIR]_x[count].dxf   e.g. 1335_B_x50.dxf
        [name]_x[count].dxf         e.g. corner_x8.dxf

Output:
    output/
        sheet_001_<name>_x<repeat>.dxf
        sheet_002_<name>_x<repeat>.dxf
        ...
        packing_report.txt
"""
import argparse
import logging
import os
import sys
import time

from parser   import load_all_parts
from packer   import pack_all_parts, validate_production
from writer   import write_sheet_dxf
from utils    import write_report
from config   import OUTPUT_DIR


def setup_logging(verbose: bool):
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format='%(asctime)s  %(levelname)-8s  %(message)s',
        datefmt='%H:%M:%S'
    )


def main():
    parser = argparse.ArgumentParser(description='ACM Sheet Metal Auto-Packer')
    parser.add_argument('input_dir', help='Directory containing input .dxf part files')
    parser.add_argument('--output', default=OUTPUT_DIR, help='Output directory')
    parser.add_argument('--verbose', action='store_true', help='Debug logging')
    args = parser.parse_args()

    setup_logging(args.verbose)
    t0 = time.time()

    logging.info(f"=== ACM Auto-Packer ===")
    logging.info(f"Input:  {os.path.abspath(args.input_dir)}")
    logging.info(f"Output: {os.path.abspath(args.output)}")

    # ── Step 1: Parse ────────────────────────────────────────────────────────
    logging.info("Step 1/4: Parsing input DXF files...")
    try:
        parts = load_all_parts(args.input_dir)
    except FileNotFoundError as e:
        logging.error(str(e))
        sys.exit(1)

    total_instances = sum(p.count for p in parts)
    logging.info(f"  {len(parts)} part type(s), {total_instances} total instances")
    for p in parts:
        logging.info(
            f"  • {p.filename:30s}  count={p.count:4d}  "
            f"CUT={p.cut_width:.1f}×{p.cut_height:.1f}mm  "
            f"dir={p.direction or '—'}"
        )

    # ── Step 2: Pack ─────────────────────────────────────────────────────────
    logging.info("Step 2/4: Packing parts into sheets...")
    layouts, mode = pack_all_parts(parts)
    logging.info(f"  Packing mode: {mode}  |  {len(layouts)} unique sheet layout(s)")

    # ── Step 3: Validate ─────────────────────────────────────────────────────
    logging.info("Step 3/4: Validating production counts...")
    warnings = validate_production(layouts, parts)
    if warnings:
        for w in warnings:
            logging.warning(f"  ⚠  {w}")
    else:
        logging.info("  ✓ All part counts satisfied")

    # ── Step 4: Write ─────────────────────────────────────────────────────────
    logging.info("Step 4/4: Writing output DXF files...")
    output_files = []
    for layout in layouts:
        fpath = write_sheet_dxf(layout, args.output)
        output_files.append(fpath)

    # ── Report ────────────────────────────────────────────────────────────────
    report_path = write_report(args.output, parts, layouts, warnings, mode)

    elapsed = time.time() - t0
    total_cuts = sum(l.repeat_count for l in layouts)
    logging.info(f"")
    logging.info(f"Done in {elapsed:.2f}s")
    logging.info(f"  {len(layouts)} unique sheet layout(s)")
    logging.info(f"  {total_cuts} total sheets to cut")
    logging.info(f"  Report: {report_path}")


if __name__ == '__main__':
    main()
```

---

## `utils.py`

```python
# utils.py
import os
import datetime
from config import SHEET_WIDTH, SHEET_HEIGHT, USABLE_WIDTH, USABLE_HEIGHT, MARGIN, OUTPUT_DIR


def write_report(output_dir: str, parts, layouts, warnings, mode: str) -> str:
    """
    Write a human-readable packing report to output_dir/packing_report.txt
    """
    os.makedirs(output_dir, exist_ok=True)
    report_path = os.path.join(output_dir, 'packing_report.txt')

    lines = []
    lines.append("=" * 70)
    lines.append("ACM SHEET METAL AUTO-PACKER — PRODUCTION REPORT")
    lines.append(f"Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("=" * 70)
    lines.append("")

    lines.append(f"Sheet size:    {SHEET_WIDTH} × {SHEET_HEIGHT} mm")
    lines.append(f"Packing mode:  {'A (35mm margin)' if mode == 'A' else 'B (full-span, centered)'}")
    if mode == 'A':
        lines.append(f"Usable area:   {USABLE_WIDTH} × {USABLE_HEIGHT} mm")
    lines.append("")

    lines.append("─" * 70)
    lines.append("INPUT PARTS")
    lines.append("─" * 70)
    total_instances = sum(p.count for p in parts)
    lines.append(f"{'Filename':<35} {'Dir':>4} {'Qty':>5} {'L0 W×H (mm)':>18} {'CUT W×H (mm)':>18}")
    lines.append("─" * 70)
    for p in parts:
        l0 = f"{p.l0_width:.1f}×{p.l0_height:.1f}"
        cut = f"{p.cut_width:.1f}×{p.cut_height:.1f}"
        lines.append(f"{p.filename:<35} {(p.direction or '—'):>4} {p.count:>5}    {l0:>18}   {cut:>18}")
    lines.append(f"{'TOTAL INSTANCES':<35} {'':>4} {total_instances:>5}")
    lines.append("")

    lines.append("─" * 70)
    lines.append("SHEET LAYOUTS")
    lines.append("─" * 70)
    total_cuts = sum(l.repeat_count for l in layouts)
    for layout in layouts:
        lines.append("")
        lines.append(f"  Sheet:    {layout.sheet_name}_x{layout.repeat_count}.dxf")
        lines.append(f"  Repeat:   ×{layout.repeat_count}  (cut {layout.repeat_count} times)")
        lines.append(f"  Mode:     {layout.mode}")
        lines.append(f"  Offset:   ({layout.offset_x:.1f}, {layout.offset_y:.1f}) mm from sheet origin")
        
        from collections import Counter
        counts = Counter(pl.part_name for pl in layout.placements)
        for part_name, cnt in sorted(counts.items()):
            lines.append(f"    • {part_name}: {cnt} instance(s)")
        
        # Utilization estimate
        area_used = sum(pl.cut_width * pl.cut_height for pl in layout.placements)
        area_sheet = SHEET_WIDTH * SHEET_HEIGHT
        util = 100 * area_used / area_sheet
        lines.append(f"  Utilization: {util:.1f}%")

    lines.append("")
    lines.append(f"TOTAL SHEETS TO CUT: {total_cuts}")
    lines.append("")

    if warnings:
        lines.append("─" * 70)
        lines.append("WARNINGS")
        lines.append("─" * 70)
        for w in warnings:
            lines.append(f"  ⚠  {w}")
        lines.append("")

    lines.append("─" * 70)
    lines.append("PRODUCTION SUMMARY")
    lines.append("─" * 70)
    lines.append(f"{'Part':<35} {'Required':>10} {'Produced':>10} {'Status':>10}")
    lines.append("─" * 70)

    from collections import Counter
    produced = Counter()
    for layout in layouts:
        cnt = Counter(pl.part_name for pl in layout.placements)
        for name, c in cnt.items():
            produced[name] += c * layout.repeat_count

    for p in parts:
        req  = p.count
        prod = produced.get(p.filename, 0)
        status = "OK" if prod >= req else "UNDER"
        lines.append(f"{p.filename:<35} {req:>10} {prod:>10} {status:>10}")

    lines.append("=" * 70)

    with open(report_path, 'w') as f:
        f.write('\n'.join(lines))

    return report_path
```

---

## `requirements.txt`

```
ezdxf>=1.3.0
rectpack>=0.2.2
shapely>=2.0.0
numpy>=1.26.0
```

---

## Running the Pipeline

```bash
# Install dependencies
pip install -r requirements.txt

# Run on a folder of part DXF files
python main.py ./input_parts/

# With custom output dir and verbose logging
python main.py ./input_parts/ --output ./sheets/ --verbose
```

---

## Implementation Order for the AI Agent

Implement modules in this exact order to allow incremental testing:

1. **`config.py`** — no dependencies, just constants. Verify all values match your physical setup.

2. **`parser.py`** — depends only on `ezdxf` and `config`. Test with the smoke test at the bottom of `PLAN_01`. Verify bboxes match what you see in your DXF viewer.

3. **`geometry.py`** — depends on `config`. Test `detect_packing_mode` with known part sets.

4. **`packer.py`** — depends on `rectpack`, `geometry`, `config`. Test with 2-3 sample parts, verify placements make sense before dedup/writer.

5. **`deduplicator.py`** — depends on `shapely`, `numpy`, `config`. Unit test `_segments_are_coincident` and `deduplicate_cut_segments` with known overlapping segments.

6. **`writer.py`** — depends on `ezdxf`, `deduplicator`, `geometry`. Open output DXF in your viewer and visually verify layout, layers, and labels.

7. **`utils.py`** — depends on nothing. Implement last.

8. **`main.py`** — wire everything together. Test end-to-end.

---

## Known Edge Cases & Tuning Points

| Issue | Where | Fix |
|---|---|---|
| Part bbox includes arcs (rounded corners, holes) | `parser.py → _entity_points` | Conservative arc bbox (±radius) already handled. Fine-tune if bboxes are too large. |
| Rotation ambiguity for square parts | `packer.py` | Square parts with no direction: rotation is irrelevant. No issue. |
| Two part types with conflicting repeat needs on same sheet | `packer.py → compute_repeat_count` | Report will flag OVER-PRODUCED. Acceptable — you'll get slightly more of one part. |
| CUT lines are LWPOLYLINE not LINE | `parser.py → _entity_to_segments` | LWPOLYLINE is handled — segments exploded from vertices. |
| DXF units (mm vs inches) | `parser.py → read_part_dxf` | Check `doc.units` on load. If units != mm, apply conversion factor before bbox computation. |
| Very large parts (>1180mm) don't fit even in Mode B | `packer.py` | Log an error and skip packing — these need manual handling. |
| Shared CUT edge is diagonal (non-axis-aligned) | `deduplicator.py` | Fully supported — `_are_collinear` uses cross-product, not axis checks. |
| Part file has no CUT layer | `parser.py` | `cut_lines = []` — part will be inserted without contributing CUT geometry. Log a warning. |
| Part file has geometry on unexpected layers | `writer.py → _get_or_create_block` | All layers are copied verbatim. Only CUT is excluded from block inserts. |

---

## Coordinate Verification Checklist

Before declaring the implementation complete, visually verify in your DXF viewer:

- [ ] Sheet boundary rectangle is exactly 1250×3200mm at origin (0,0)
- [ ] Mode A: First part's CUT boundary bottom-left corner is at (35, 35)
- [ ] Mode A: No part's CUT boundary extends beyond (1215, 3165)
- [ ] Mode B: Layout is visually centered — equal left/right and top/bottom gaps
- [ ] Adjacent parts: their CUT boundaries touch exactly (zero gap)
- [ ] Shared CUT edges: only ONE line where two parts touch (no double lines)
- [ ] Layer 0 outlines are 3mm inside the CUT boundaries (not touching the sheet edges)
- [ ] FREZ/FREZ_135/HOLES layers are present and correct in all parts
- [ ] Sheet label text is above the sheet, readable, correct repeat count
- [ ] Packing report repeat count matches manual calculation
