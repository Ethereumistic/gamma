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
    line_to_segment_map: dict[int, int] = field(default_factory=dict)
    contours_by_layer: dict[str, list[dict]] = field(default_factory=dict)
    stock_bbox: dict = field(default_factory=dict)


def run_from_contours(
    contours_by_layer: dict[str, list[dict]],
    stock_bbox: dict,
    scenario: str,
    algorithm: str,
    original_filename: str = ""
) -> dict:
    from .models import Point, Contour, BBox
    from .geometry import sort_frez_outer_to_inner, sort_nearest_neighbour
    from .toolpath import generate_toolpath
    from .gcode_writer import GCodeWriter
    from .validator import validate
    from .config import SCENARIOS, LAYER_FREZ, LAYER_FREZ_135

    bbox = BBox(
        stock_bbox["min_x"], stock_bbox["min_y"],
        stock_bbox["max_x"], stock_bbox["max_y"],
    )

    prepared: dict[str, list[Contour]] = {}
    for layer, raw_contours in contours_by_layer.items():
        prepared[layer] = [
            Contour(
                points=[Point(p["x"], p["y"]) for p in rc["points"]],
                is_closed=rc["is_closed"],
            )
            for rc in raw_contours
        ]

    toolpath_sequence = SCENARIOS.get(scenario, [])
    
    toolpath_blocks = []
    out_segments = []
    seq_index = 0
    warnings = []

    for layer_name, tool_num in toolpath_sequence:
        if layer_name not in prepared:
            continue
            
        contours = prepared[layer_name]
        
        if layer_name in (LAYER_FREZ, LAYER_FREZ_135):
            ordered = sort_frez_outer_to_inner(contours, bbox, algorithm)
        else:
            ordered = sort_nearest_neighbour(contours)
            
        start_idx = seq_index
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

        moves, _ = generate_toolpath(ordered, tool_num, layer_name, start_seq_index=start_idx)
        toolpath_blocks.append((tool_num, layer_name, moves))

    if not toolpath_blocks:
        raise ValueError("No toolpath blocks generated — check DXF layer names")

    cnc_layers = {layer_name for layer_name, _ in toolpath_sequence}
    ref_layers = [l for l in prepared.keys() if l not in cnc_layers]
    for ref_layer in ref_layers:
        ref_contours = prepared[ref_layer]
        for contour in ref_contours:
            for i in range(len(contour.points) - 1):
                p1 = contour.points[i]
                p2 = contour.points[i+1]
                out_segments.append({
                    "x1": p1.x, "y1": p1.y,
                    "x2": p2.x, "y2": p2.y,
                    "layer": ref_layer,
                    "seq_index": seq_index,
                })
                seq_index += 1
            if contour.is_closed and len(contour.points) > 0:
                p1 = contour.points[-1]
                p2 = contour.points[0]
                out_segments.append({
                    "x1": p1.x, "y1": p1.y,
                    "x2": p2.x, "y2": p2.y,
                    "layer": ref_layer,
                    "seq_index": seq_index,
                })
                seq_index += 1

    import os
    stem = os.path.splitext(os.path.basename(original_filename or "regenerated"))[0]
    writer = GCodeWriter(program_name=stem)
    nc_text, line_to_segment_map = writer.write(toolpath_blocks, bbox)

    validation = validate(nc_text, [t for t, _, _ in toolpath_blocks], bbox)
    warnings.extend(validation.warnings)

    lift_count = sum(
        sum(1 for m in moves if m.type == "retract")
        for _, _, moves in toolpath_blocks
    )
    total_length = writer.total_path_length
    avg_feed = 5500
    estimated_time = (total_length / avg_feed) * 60

    geometry_data = {
        "segments": out_segments,
        "layers": list(prepared.keys()),
        "bbox": stock_bbox
    }

    return {
        "nc_text": nc_text,
        "geometry_data": geometry_data,
        "line_to_segment_map": line_to_segment_map,
        "estimated_time": estimated_time,
        "warnings": warnings,
        "lift_count": lift_count,
        "tools_used": [t for t, _, _ in toolpath_blocks],
        "output_filename": f"{stem}-{algorithm}.nc",
    }


def run_pipeline(dxf_path: str, original_filename: str = "", algorithm: str = "raptor") -> PipelineResult:
    """
    Full pipeline: DXF file → PipelineResult containing NC text.
    Raises ValueError for unrecoverable errors (missing CUT layer, etc.).
    """
    from .dxf_reader import DXFReader
    from .scenario import detect_scenario
    from .models import Point, BBox, Contour
    from .geometry import sort_outer_to_inner, sort_frez_outer_to_inner, sort_nearest_neighbour, simplify_contour
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

    prepared_contours = {}
    total_contours = 0

    for layer_name, tool_num in toolpath_sequence:
        contours = reader.get_contours(layer_name)
        if not contours:
            warnings.append(f"Layer {layer_name} has no geometry — skipping")
            continue

        contours = [simplify_contour(c) for c in contours]
        total_contours += len(contours)
        prepared_contours[layer_name] = contours

    cnc_layers = {layer_name for layer_name, _ in toolpath_sequence}
    ref_layers = [l for l in reader.layers if l not in cnc_layers]
    for layer_name in ref_layers:
        contours = reader.get_contours(layer_name)
        if contours:
            prepared_contours[layer_name] = contours

    contours_by_layer: dict[str, list[dict]] = {}
    for layer_name, contours in prepared_contours.items():
        contours_by_layer[layer_name] = [
            {
                "points": [{"x": p.x, "y": p.y} for p in c.points],
                "is_closed": c.is_closed,
            }
            for c in contours
        ]

    stock_bbox_serial = {
        "min_x": bbox.min_x,
        "max_x": bbox.max_x,
        "min_y": bbox.min_y,
        "max_y": bbox.max_y,
    }

    result = run_from_contours(
        contours_by_layer=contours_by_layer,
        stock_bbox=stock_bbox_serial,
        scenario=scenario_name,
        algorithm=algorithm,
        original_filename=dxf_path if not original_filename else original_filename
    )
    result["warnings"].extend(warnings)

    return PipelineResult(
        scenario=scenario_name,
        layers_detected=list(reader.layers),
        tools_used=result["tools_used"],
        contour_count=total_contours,
        lift_count=result["lift_count"],
        estimated_time_seconds=result["estimated_time"],
        warnings=result["warnings"],
        nc_text=result["nc_text"],
        output_filename=result["output_filename"],
        geometry_data=result["geometry_data"],
        line_to_segment_map=result["line_to_segment_map"],
        contours_by_layer=contours_by_layer,
        stock_bbox=stock_bbox_serial,
    )