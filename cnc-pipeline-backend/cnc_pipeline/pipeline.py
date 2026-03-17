# cnc_pipeline/pipeline.py
from dataclasses import dataclass, field
import os


@dataclass
class PipelineResult:
    scenario:          str           # "most_common" | "common" | "rare" | "very_rare" | "cut_only"
    layers_detected:   list[str]     # e.g. ["CUT", "FREZ"]
    tools_used:        list[int]     # e.g. [9, 7]
    contour_count:     int           # total contours across all layers
    lift_count:        int           # total retract moves (= total contours - 1 per toolpath + toolpaths)
    estimated_time_seconds: float    # rough estimate based on path length / feed rate
    warnings:          list[str]     # non-fatal issues found during generation
    nc_text:           str           # the complete generated NC program
    output_filename:   str           # e.g. "part_name.nc"
    geometry_data:     dict          # ordered geometry segments for frontend rendering


def run_pipeline(dxf_path: str, original_filename: str = "") -> PipelineResult:
    """
    Full pipeline: DXF file → PipelineResult containing NC text.
    Raises ValueError for unrecoverable errors (missing CUT layer, etc.).
    """
    from .dxf_reader import DXFReader
    from .scenario import detect_scenario
    from .geometry import join_segments, sort_outer_to_inner, sort_nearest_neighbour, simplify_contour
    from .toolpath import generate_toolpath
    from .gcode_writer import GCodeWriter
    from .validator import validate
    from .config import SCENARIOS, LAYER_CUT, LAYER_FREZ, LAYER_FREZ_135, LAYER_HOLES

    warnings = []

    # 1. Read DXF
    reader = DXFReader(dxf_path)
    bbox = reader.get_bounding_box()

    # 2. Detect scenario
    scenario_name = detect_scenario(reader.layers)
    toolpath_sequence = SCENARIOS[scenario_name]  # list of (layer, tool_num)

    # 3. For each layer in sequence: extract → join → sort → generate moves
    toolpath_blocks = []
    total_contours = 0
    seq_index = 0
    out_segments = []

    for layer_name, tool_num in toolpath_sequence:
        segments = reader.get_entities(layer_name)
        if not segments:
            warnings.append(f"Layer {layer_name} has no geometry — skipping")
            continue

        contours = join_segments(segments)
        contours = [simplify_contour(c) for c in contours]
        total_contours += len(contours)

        # Sort order depends on layer type
        if layer_name in (LAYER_FREZ, LAYER_FREZ_135):
            ordered = sort_outer_to_inner(contours, bbox)
        else:
            ordered = sort_nearest_neighbour(contours)

        for contour in ordered:
            for i in range(len(contour.points) - 1):
                p1 = contour.points[i]
                p2 = contour.points[i+1]
                out_segments.append({
                    "x1": p1.x, "y1": p1.y,
                    "x2": p2.x, "y2": p2.y,
                    "layer": layer_name,
                    "seq_index": seq_index
                })
                seq_index += 1
            if contour.is_closed and len(contour.points) > 0:
                p1 = contour.points[-1]
                p2 = contour.points[0]
                out_segments.append({
                    "x1": p1.x, "y1": p1.y,
                    "x2": p2.x, "y2": p2.y,
                    "layer": layer_name,
                    "seq_index": seq_index
                })
                seq_index += 1

        moves = generate_toolpath(ordered, tool_num, layer_name)
        toolpath_blocks.append((tool_num, layer_name, moves))

    if not toolpath_blocks:
        raise ValueError("No toolpath blocks generated — check DXF layer names")

    # 3b. Append reference-only layers (SHEETS, "0", etc.) to geometry for
    #     frontend visualisation ONLY — never touches toolpath_blocks or NC output.
    cnc_layers = {layer_name for layer_name, _ in toolpath_sequence}
    ref_layers = [l for l in reader.layers if l not in cnc_layers]
    for ref_layer in ref_layers:
        ref_segments = reader.get_entities(ref_layer)
        for seg in ref_segments:
            out_segments.append({
                "x1": seg.start.x, "y1": seg.start.y,
                "x2": seg.end.x,   "y2": seg.end.y,
                "layer": ref_layer,
                "seq_index": seq_index,
            })
            seq_index += 1

    # 4. Write G-code
    stem = os.path.splitext(os.path.basename(original_filename or dxf_path))[0]
    writer = GCodeWriter(program_name=stem)
    nc_text = writer.write(toolpath_blocks, bbox)

    # 5. Validate
    validation = validate(nc_text, [t for t, _, _ in toolpath_blocks], bbox)
    warnings.extend(validation.warnings)

    # 6. Compute stats
    lift_count = sum(
        sum(1 for m in moves if m.type == "retract")
        for _, _, moves in toolpath_blocks
    )
    total_length = writer.total_path_length
    avg_feed = 5500  # mm/min — rough estimate
    estimated_time = (total_length / avg_feed) * 60  # seconds

    geometry_data = {
        "segments": out_segments,
        "layers": list(reader.layers),
        "bbox": {
            "min_x": bbox.min_x,
            "min_y": bbox.min_y,
            "max_x": bbox.max_x,
            "max_y": bbox.max_y,
        }
    }

    return PipelineResult(
        scenario=scenario_name,
        layers_detected=list(reader.layers),
        tools_used=[t for t, _, _ in toolpath_blocks],
        contour_count=total_contours,
        lift_count=lift_count,
        estimated_time_seconds=estimated_time,
        warnings=warnings,
        nc_text=nc_text,
        output_filename=f"{stem}.nc",
        geometry_data=geometry_data,
    )