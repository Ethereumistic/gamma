# ACM Sheet Metal Auto-Packer — Technical Implementation Plan

## Project Overview

Replace the manual DXF merge step with a fully automated pipeline that:
1. Reads all individual part `.dxf` files from an input folder
2. Parses part metadata from filenames
3. Packs all required instances into 1250×3200mm sheets using CUT-space nesting with shared-edge deduplication
4. Outputs one `.dxf` per unique sheet layout, labeled with repeat count

---

## Repository Structure

```
autopacker/
├── main.py                  # CLI entry point
├── config.py                # All constants (sheet dims, offsets, tolerances)
├── parser.py                # Filename parser + DXF part reader
├── geometry.py              # CUT bbox extraction, coordinate transforms
├── packer.py                # MaxRects bin packing engine
├── deduplicator.py          # CUT line shared-edge deduplication (Shapely)
├── writer.py                # DXF sheet output generator (ezdxf)
├── utils.py                 # Logging, file helpers
├── requirements.txt
└── README.md
```

---

## Dependencies

```
ezdxf>=1.3.0
rectpack>=0.2.2
shapely>=2.0.0
numpy>=1.26.0
```

---

## Module-by-Module Specification

See companion files:
- [`PLAN_01_config_parser.md`](./PLAN_01_config_parser.md) — config, filename parsing, DXF reading
- [`PLAN_02_geometry_packer.md`](./PLAN_02_geometry_packer.md) — geometry model, packing engine, placement modes
- [`PLAN_03_dedup_writer.md`](./PLAN_03_dedup_writer.md) — CUT deduplication, DXF sheet writer
- [`PLAN_04_main_cli.md`](./PLAN_04_main_cli.md) — main pipeline, CLI, logging, edge cases

---

## End-to-End Data Flow

```
input/
  ├── 1335_B_x50.dxf
  ├── 0004_T_x1.dxf
  ├── corner_x8.dxf
  └── ...
        │
        ▼
[1] PARSE (parser.py)
    • Filename → name, direction (T/B/L/R or None), count
    • Read DXF → extract Layer 0 bbox, extract CUT layer line entities
    • Build Part dataclass per file

        │
        ▼
[2] GEOMETRY (geometry.py)
    • CUT bbox = Layer 0 bbox + 3mm outward on all sides (= +6mm W and H)
    • Determine rotation_locked: True if direction present
    • Normalize direction: T/B → vertical lock, L/R → horizontal lock

        │
        ▼
[3] MODE DETECTION (packer.py)
    • For each combination of parts to pack together:
      – If any CUT width ≥ 1180 OR CUT height ≥ 3130 → Mode B (full-span, centered)
      – If pair CUT widths sum ≥ 1180 → Mode B for that pair
      – Otherwise → Mode A (35mm margin, usable 1180×3130)

        │
        ▼
[4] PACK (packer.py)
    • Expand parts by count → flat list of rect items (CUT dimensions)
    • Sort: largest CUT area first
    • Run MaxRects BSSF + BAF + BLSF in parallel
    • Keep result with fewest sheets
    • For Mode B layouts: apply centering offset post-pack

        │
        ▼
[5] SHEET REPEAT COMPUTATION (packer.py)
    • Per output bin: count instances of each part type
    • Repeat = min over all part types of ceil(required / placed_per_sheet)
    • Assign sheet name + repeat label

        │
        ▼
[6] DEDUPLICATION (deduplicator.py)
    • For each sheet: collect all CUT layer line segments (transformed to sheet coords)
    • Detect coincident segments: collinear + spatially overlapping within 0.01mm
    • Retain one copy of each shared edge, discard duplicates

        │
        ▼
[7] WRITE (writer.py)
    • Per unique sheet layout:
      – SHEETS layer: outer rect, 35mm inner offset rect (Mode A) or centered guides (Mode B)
      – Non-CUT geometry: block inserts per part (preserves FREZ, FREZ_135, HOLES, Layer 0)
      – CUT layer: write deduplicated line segments directly (NOT via block inserts)
      – Label: "sheet_name_xN" as TEXT entity above sheet boundary
    • Save as output/sheet_001.dxf, sheet_002.dxf, etc.

        │
        ▼
output/
  ├── sheet_001_x11.dxf
  ├── sheet_002_x4.dxf
  └── packing_report.txt
```

---

## Critical Design Decisions

### CUT-Space Packing (not Layer-0 space)
All packing coordinates use CUT layer dimensions. A part with Layer 0 bbox of 500×500mm has a CUT bbox of 506×506mm (3mm outward on all 4 sides). Parts are placed touching at their CUT boundaries — zero gap — so adjacent parts share one physical CUT line.

### Block Insert Coordinate Transform
When inserting a block at packing position `(x, y)` in CUT space, the actual DXF block insert goes at `(x + offset_x, y + offset_y)` where:
- `offset_x = margin_x + 3` (3mm = the CUT outset from Layer 0 origin)
- `offset_y = margin_y + 3`

The CUT lines are written separately, NOT through block inserts, to enable deduplication.

### Rotation Locking
- Part with direction T or B → lock to 0° rotation (height axis is vertical)
- Part with direction L or R → lock to 90° rotation (width axis is vertical)  
- Part with no direction → allow both 0° and 90°, packer chooses

### Mode A vs Mode B
| | Mode A | Mode B |
|---|---|---|
| Trigger | All parts ≤ 1180mm wide AND ≤ 3130mm tall | Any part or combo ≥ sheet boundary |
| Usable packing area | 1180 × 3130mm | 1250 × 3200mm |
| First part position | BL corner of usable area = (35, 35) on sheet | Entire layout centered on sheet |
| Margin rects | Draw 35mm inner offset rect | Draw equal-margin guide rects |

### Shared-Edge Deduplication
Two CUT line segments are deduplicated when:
1. Distance between them < 0.01mm (coincident)
2. They are collinear (cross product of direction vectors < tolerance)
3. Their 1D projections along the shared axis overlap

One segment is retained. The other is discarded. The retained segment must span the full union of both overlapping segments (use the longer one, or merge endpoints).
