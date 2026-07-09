# CNC Pipeline Feature Explained

## Purpose

The CNC pipeline is the third and final step in the fenestration production workflow:

```text
SHEETS -> NESTING -> CNC PIPELINE -> production
```

It takes a nested DXF layout (or any DXF with `CUT`, `FREZ`, `FREZ_135`, and `HOLES` layers), detects which machining operations are required, selects the correct tools and cutting order, optimises the toolpath for vacuum hold-down and rapid-travel minimisation, and produces a Fanuc-compatible `.nc` G-code program ready for the CNC machine.

The pipeline runs as a Python FastAPI service. The frontend uploads a DXF, the backend processes it through the full pipeline, and returns NC text, geometry visualisation data, tool usage, and estimated machining time.

## Main Files

- `cnc-pipeline-backend/main.py`: FastAPI application with endpoints for generate, regenerate, preview, download, and layer diagnosis.
- `cnc-pipeline-backend/cnc_pipeline/pipeline.py`: top-level orchestration — reads DXF, detects scenario, resolves custom sequences, delegates to `run_from_contours`, and assembles `PipelineResult`.
- `cnc-pipeline-backend/cnc_pipeline/dxf_reader.py`: DXF ingestion via `ezdxf`. Extracts per-layer contours as polylines, detects closure, and computes bounding boxes.
- `cnc-pipeline-backend/cnc_pipeline/scenario.py`: layer-based scenario detection (`most_common`, `common`, `rare`, `very_rare`, `cut_only`, `custom`).
- `cnc-pipeline-backend/cnc_pipeline/config.py`: tool definitions, layer constants, scenario-to-tool mappings, Z heights, stock expansion, G-code line numbering, and override-aware tool builder.
- `cnc-pipeline-backend/cnc_pipeline/geometry.py`: contour simplification, bounding-box utilities, outer-to-inner sorting for CUT, nearest-neighbour sorting, and FREZ algorithm dispatch.
- `cnc-pipeline-backend/cnc_pipeline/algo_juggler_gemini.py`: "Juggler Gemini" FREZ sorting — percentage-depth scoring, thick anti-juggling tiers, horizontal-before-vertical vacuum preservation.
- `cnc-pipeline-backend/cnc_pipeline/algo_juggler_claude.py`: "Juggler Claude" FREZ sorting — normalised perpendicular scoring, tier merging, pure nearest-neighbour within tiers.
- `cnc-pipeline-backend/cnc_pipeline/toolpath.py`: converts sorted contours into `Move` sequences (rapid, plunge, cut, retract) with feed rates and coolant control.
- `cnc-pipeline-backend/cnc_pipeline/gcode_writer.py`: serialises toolpath blocks into numbered Fanuc G-code with tool-change headers, comment blocks, and coordinate deduplication.
- `cnc-pipeline-backend/cnc_pipeline/validator.py`: post-generation validation — M30 termination, tool sequence, coolant pairing, Z depth bounds, X/Y margin checks, line-number ordering.
- `cnc-pipeline-backend/cnc_pipeline/models.py`: `Point`, `Segment`, `BBox`, `Contour`, `Move` dataclasses.

## Pipeline Flow

```text
DXF file
  │
  ▼
DXFReader ─────────────────────── contours per layer + bounding box
  │
  ▼
detect_scenario ───────────────── scenario name (most_common, rare, …)
  │
  ▼
resolve tool sequence ──────────── [(layer, tool_id), …] from scenario or custom_sequence
  │
  ▼
simplify_contour (per contour)
  │
  ▼
sort contours ──────────────────── outer→inner for CUT, FREZ algorithm for FREZ/FREZ_135, NN for HOLES
  │
  ▼
generate_toolpath ──────────────── Move sequences per layer/tool pair
  │
  ▼
GCodeWriter.write ──────────────── NC text + line→segment map
  │
  ▼
validate ───────────────────────── warnings list
  │
  ▼
PipelineResult ────────────────── NC text, geometry data, scenario, tools used, estimated time
```

The `/api/generate` endpoint runs the full flow from a DXF file. The `/api/regenerate` endpoint re-runs from already-extracted contours (no DXF re-read), allowing the frontend to change algorithm, tool overrides, or custom sequence without re-uploading.

## DXF Reader

`DXFReader` uses `ezdxf` to parse the uploaded file. For each requested layer it:

1. Queries all entities matching `*[layer=="{layer}"]`.
2. Converts each entity to an `ezdxf.path` via `make_path`.
3. Flattens the path to line segments at 0.01 mm chord tolerance.
4. Detects closure when start and end points are within 0.001 mm² distance.

The result is a list of `Contour` objects per layer — each an ordered sequence of `Point`s with an `is_closed` flag.

Bounding box resolution prefers the `SHEETS` layer. If `SHEETS` is absent, it falls back to the union of all layers. This matches the nesting export convention where `SHEETS` defines the physical stock boundary.

## Scenario Detection

`detect_scenario` maps DXF layer presence to a named machining scenario:

| Scenario | Layers required | Tool sequence |
| --- | --- | --- |
| `very_rare` | HOLES + FREZ + FREZ_135 | HOLES→prav, FREZ→trapec_105, FREZ_135→trapec_135, CUT→prav |
| `common` | HOLES + FREZ | HOLES→prav, FREZ→trapec_105, CUT→prav |
| `rare` | FREZ + FREZ_135 | FREZ→trapec_105, FREZ_135→trapec_135, CUT→prav |
| `most_common` | FREZ | FREZ→trapec_105, CUT→prav |
| `cut_only` | CUT only | CUT→prav |
| `custom` | no standard layers | requires `custom_sequence` from caller |

The scenario determines which layers get machined and in what order. When no standard layers are found and no `custom_sequence` is provided, the pipeline raises an error.

## Tool Definitions

Tools are defined in `config.py` as a dictionary keyed by unique tool ID:

| Tool ID | Pocket | Name | Diameter | RPM | Feed | Plunge | Layers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `prav` | T7 | End Mill | 6 mm | 24000 | 5500 | 550 | CUT, HOLES |
| `trapec_105` | T9 | Tapered Tipped | 13 mm | 13000 | 5500 | 550 | FREZ |
| `trapec_135` | T11 | Tapered Tipped | 13 mm | 13000 | 5500 | 550 | FREZ_135 |

Each tool entry also stores gauge length, flutes, taper angle/height, and per-layer depth and offset. The `build_tools_dict()` function deep-merges caller-provided overrides and supports both the new ID-based keys and legacy number-based keys for backward compatibility.

Custom tools can be added via the `tool_overrides` parameter — any tool ID not present in the built-in dictionary that includes a `number` field is accepted as a full tool definition.

## Contour Sorting

The pipeline uses different sorting strategies depending on the layer:

**CUT layers** use `sort_outer_to_inner` — a centroid-distance sort that cuts the outermost perimeter first, then progressively inner contours. This ensures the vacuum hold-down remains effective.

**FREZ and FREZ_135 layers** use one of two "Juggler" algorithms selected by the `algorithm` parameter:

- **Juggler Gemini** (`juggler_gemini`): Scores each contour by percentage depth into the sheet (0% = edge, 50% = centre). Groups into 10% depth tiers. Centre tiers (≥25%) enforce horizontal-before-vertical to preserve vacuum. Within each tier, nearest-neighbour routing minimises rapids.

- **Juggler Claude** (`juggler_claude`): Normalises perpendicular distance by the axis-specific half-dimension, eliminating the aspect-ratio bias on non-square sheets. Groups into tight tiers (0.2% normalised), merges adjacent tiers within 2% tolerance, then runs nearest-neighbour within each merged tier. No forced side-alternation; vacuum integrity is preserved by tier ordering alone.

Both algorithms may reverse individual contour point order to enter from the closer endpoint.

**HOLES and other layers** use `sort_nearest_neighbour` — groups contours by bounding-box area tiers, then applies greedy nearest-neighbour within each tier.

## Toolpath Generation

`generate_toolpath` converts sorted contours into `Move` sequences:

- **First contour**: rapid to start point, plunge to cutting depth, cut along contour points, retract to `Z_CLEARANCE` (10 mm).
- **Subsequent contours**: rapid to next start XY, rapid to approach Z (5 mm), plunge, cut, retract.
- **Closed contours**: add a closing cut move from last point back to start.
- **Coolant**: M8 on the first plunge, M9 before each tool change or at program end.

Each `Move` carries a `seq_index` that maps it back to the geometry segment for frontend visualisation.

## G-code Writer

`GCodeWriter` produces numbered Fanuc G-code (`N40`, `N50`, … with `LINE_NUM_INCREMENT` spacing). Per toolpath block it emits:

1. **Tool change**: `T<n>M6`
2. **Work coordinate**: `G54G90`
3. **Comment block**: program metadata — tool name, diameter, taper parameters, bounding box with `STOCK_EXPANSION` (9 mm per side), gauge length, flutes, path length, estimated time, lift count, safety notices.
4. **First rapid**: `G43G0 X… Y… Z5. S<rpm> H<pocket> M3` — length compensation, approach, spindle on.
5. **Cutting moves**: G0/G1 with deduplicated coordinates and feed rates. Only X/Y/Z values that actually change are emitted.
6. **Between blocks**: `M9` coolant off, rapid to next tool's start position, line-number gap.
7. **Final block**: `M9`, `G91G28Z0`, `G49H0`, `G28X0Y0`, `M30`.

The writer tracks `total_path_length` across all blocks for time estimation. It also builds a `line_to_segment_map` dictionary that maps NC line numbers to geometry segment indices, enabling the frontend to highlight which segment corresponds to which G-code line.

## API Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | Liveness check |
| `/api/generate` | POST | Full pipeline: DXF upload → NC output |
| `/api/regenerate` | POST | Re-run from contours (no DXF re-read) |
| `/api/preview/{job_id}` | GET | Return stored NC text |
| `/api/download/{job_id}` | GET | Download `.nc` file |
| `/api/diagnose-layers` | POST | Debug layer/entity report for a DXF |

`/api/generate` accepts:
- `file`: DXF file upload
- `algorithm`: `juggler_gemini` (default) or `juggler_claude`
- `tool_overrides`: JSON dict of tool parameter overrides
- `custom_sequence`: JSON array of `[layer, tool_ref]` pairs (new string IDs or legacy pocket numbers)

`/api/regenerate` accepts a JSON body with pre-extracted `contours_by_layer`, `stock_bbox`, `scenario`, `algorithm`, optional `tool_overrides`, and optional `custom_sequence`.

Jobs are stored in an in-memory dictionary keyed by UUID — sufficient for single-operator local use.

## Geometry Data for Frontend

The pipeline returns a `geometry_data` object containing:
- `segments`: array of `{x1, y1, x2, y2, layer, seq_index}` for drawing toolpath visualisation
- `layers`: list of layer names present in the DXF
- `bbox`: bounding box `{min_x, min_y, max_x, max_y}`

Reference layers (those not in the CNC toolpath sequence, like `SHEETS` and `0`) are included as non-machined segments so the frontend can draw the sheet outline and part labels.

## Custom Sequences

The `custom_sequence` parameter overrides the scenario-based default toolpath order. Each entry is `[layer_name, tool_id_or_number]`:

- New format: `["CUT", "prav"]` — string tool ID
- Legacy format: `["CUT", 7]` — pocket number, auto-resolved to the matching tool ID

Tool number `0` is a placeholder: it resolves to the default tool for that layer from `LAYER_TOOL_MAP`, or the first available tool.

Custom sequences are validated against the current tool dictionary. Unknown tool IDs or layers not present in the DXF are rejected.

## Coordinate System and Heights

| Constant | Value | Meaning |
| --- | --- | --- |
| `Z_CLEARANCE` | 10.0 mm | Retract height after each contour |
| `Z_APPROACH` | 5.0 mm | Approach height before plunge |
| `Z_SAFE_RAPID` | 5.0 mm | Z on the first rapid move |
| `STOCK_EXPANSION` | 9.0 mm | Padding added to bounding box in NC header comments |

Cutting depths are per-tool per-layer (e.g., CUT at −4.1 mm, FREZ at −3.0 mm) and come from the tool definition's `layers` config. The `offset` field in the layer config is available for future diameter compensation but is not currently applied in the G-code writer.

## Validation

`validate()` checks the generated NC text for:

1. Program ends with `M30`.
2. Tool change sequence matches expected tools.
3. M8/M9 coolant commands are balanced.
4. No Z depth exceeds −5.0 mm.
5. No X/Y coordinate exceeds the bounding box + 35 mm margin.
6. N-line numbers are strictly increasing.

All issues are reported as warnings — they do not block NC generation.

## Testing Guidance

Run tests from `cnc-pipeline-backend/`.

```bash
pytest tests                          # full suite
pytest tests/test_scenario.py         # scenario detection
pytest tests/test_geometry.py         # sorting and simplification
pytest tests/test_toolpath.py         # toolpath generation
pytest tests/test_gcode_writer.py     # G-code output
pytest tests/test_pipeline.py         # end-to-end pipeline
pytest tests/test_dxf_reader.py       # DXF parsing
```

For G-code changes, compare output against `NC/` fixture files. For FREZ sorting changes, measure total rapid-travel distance against known baselines.

Sample DXF files live in `DXF/`, golden NC files in `NC/`, and comparison fixtures in `compare_files/`.

## Agent Notes

Preserve these invariants:

- Layer names (`CUT`, `FREZ`, `FREZ_135`, `HOLES`, `SHEETS`, `0`) must match the nesting and sheet-metal exports exactly — they are the contract between all three pipeline stages.
- The scenario system assumes that if `HOLES` is present, it is machined first. If `FREZ_135` is present, it is machined before `CUT`. Do not reorder without understanding vacuum hold-down implications.
- FREZ sorting must always cut from outside to inside. Violating this can cause the part to shift on the vacuum table.
- The G-code output must remain Fanuc-compatible. Changes to line numbering, coordinate formatting, or block structure should be validated against the machine controller's expectations.
- `build_tools_dict` must handle both ID-based and legacy number-based override keys for backward compatibility with existing frontend calls.
- Tool depths (`-4.1`, `-3.0`, etc.) and stock expansion (`9 mm`) are production parameters — change them only with operator approval.
- When adding new endpoints or modifying the API, remember the in-memory job store has no persistence. Restarting the backend clears all jobs.
- The `SHEETS` layer is used only for bounding-box detection and is never machined. The `0` layer is reference geometry only.