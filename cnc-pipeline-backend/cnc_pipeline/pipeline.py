# cnc_pipeline/pipeline.py
from dataclasses import dataclass, field
import os


@dataclass
class PipelineResult:
    scenario:          str
    layers_detected:   list[str]
    tools_used:        list[int]
    contour_count:     int
    lift_count:        int
    estimated_time_seconds: float
    warnings:          list[str]
    nc_text:           str
    output_filename:   str
    geometry_data:     dict
    line_to_segment_map: dict[int, int] = field(default_factory=dict)
    contours_by_layer: dict[str, list[dict]] = field(default_factory=dict)
    stock_bbox: dict = field(default_factory=dict)


def _resolve_tool_ref(tool_ref) -> str:
    """Resolve a tool reference from custom_sequence to a tool ID string.
    Accepts both new format (str tool_id) and legacy format (int tool_number).
    For legacy number references, we try to find a matching tool in the defaults.
    """
    if isinstance(tool_ref, str):
        return tool_ref
    # Legacy: tool number — caller must resolve against the tools dict
    return str(tool_ref)


def _resolve_custom_sequence(custom_sequence, tools: dict[str, dict]) -> list[tuple[str, str]]:
    """Validate and resolve a custom_sequence to [(layer, tool_id), ...].
    Handles both new format [[layer, tool_id], ...] and legacy [[layer, tool_number], ...].
    """
    from .config import LAYER_TOOL_MAP

    validated = []
    for entry in custom_sequence:
        if not isinstance(entry, list) or len(entry) < 2:
            raise ValueError(f"Invalid custom_sequence entry: {entry} — expected [layer, tool_ref]")
        layer = str(entry[0])
        tool_ref = entry[1]

        if isinstance(tool_ref, str):
            # New format: tool_id
            tool_id = tool_ref
        elif isinstance(tool_ref, (int, float)):
            # Legacy format: tool_number → find matching tool ID
            tool_num = int(tool_ref)

            if tool_num == 0:
                # Tool number 0 is a placeholder — resolve from LAYER_TOOL_MAP
                # or fall back to the first available tool
                if layer in LAYER_TOOL_MAP and LAYER_TOOL_MAP[layer] in tools:
                    tool_id = LAYER_TOOL_MAP[layer]
                else:
                    # Fall back to first available tool sorted by number
                    sorted_tools = sorted(tools.items(), key=lambda x: x[1]["number"])
                    if sorted_tools:
                        tool_id = sorted_tools[0][0]
                    else:
                        raise ValueError(f"No tools available for custom_sequence layer {layer}")
            else:
                # Find tool(s) with this number
                matches = [tid for tid, t in tools.items() if t["number"] == tool_num]
                if not matches:
                    raise ValueError(f"Unknown tool number in custom_sequence: T{tool_num} for layer {layer}")
                # When multiple tools share a pocket number, prefer the one whose
                # layers dict explicitly lists this layer; otherwise use first match
                layer_match = [tid for tid in matches if layer in tools[tid].get("layers", {})]
                tool_id = layer_match[0] if layer_match else matches[0]
        else:
            raise ValueError(f"Invalid tool reference in custom_sequence: {tool_ref}")

        tool_id = str(tool_id)

        if tool_id not in tools:
            raise ValueError(f"Unknown tool ID in custom_sequence: {tool_id} for layer {layer}")

        validated.append((layer, tool_id))
    return validated


def run_from_contours(
    contours_by_layer: dict[str, list[dict]],
    stock_bbox: dict,
    scenario: str,
    algorithm: str,
    original_filename: str = "",
    tool_overrides: dict | None = None,
    custom_sequence: list[list] | None = None,
) -> dict:
    from .models import Point, Contour, BBox
    from .geometry import sort_frez_outer_to_inner, sort_nearest_neighbour
    from .toolpath import generate_toolpath
    from .gcode_writer import GCodeWriter
    from .validator import validate
    from .config import SCENARIOS, LAYER_FREZ, LAYER_FREZ_135, build_tools_dict
    import logging

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

    tools = build_tools_dict(tool_overrides)

    # ── Determine toolpath sequence ──
    if custom_sequence:
        logging.getLogger("cnc_pipeline").info(f"run_from_contours using custom_sequence: {custom_sequence}")
        validated = _resolve_custom_sequence(custom_sequence, tools)
        # Filter to only layers present in the DXF
        toolpath_sequence = [(l, t) for l, t in validated if l in prepared]
        if not toolpath_sequence:
            raise ValueError("custom_sequence contained no valid layers present in the DXF")
    else:
        toolpath_sequence = SCENARIOS.get(scenario, [])

    toolpath_blocks = []
    out_segments = []
    seq_index = 0
    warnings = []

    for layer_name, tool_id in toolpath_sequence:
        if layer_name not in prepared:
            continue

        tool = tools[tool_id]
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

        moves, _ = generate_toolpath(ordered, tool, layer_name, start_seq_index=start_idx)
        toolpath_blocks.append((tool_id, layer_name, moves))

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

    stem = os.path.splitext(os.path.basename(original_filename or "regenerated"))[0]
    writer = GCodeWriter(program_name=stem)
    nc_text, line_to_segment_map = writer.write(toolpath_blocks, bbox, tools=tools)

    validation = validate(nc_text, [tools[tid]["number"] for tid, _, _ in toolpath_blocks], bbox)
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
        "tools_used": [tools[tid]["number"] for tid, _, _ in toolpath_blocks],
        "output_filename": f"{stem}-{algorithm}.nc",
    }


def run_pipeline(dxf_path: str, original_filename: str = "", algorithm: str = "juggler_gemini", tool_overrides: dict | None = None, custom_sequence: list[list] | None = None) -> PipelineResult:
    """
    Full pipeline: DXF file → PipelineResult containing NC text.
    """
    from .dxf_reader import DXFReader
    from .scenario import detect_scenario
    from .models import Point, BBox, Contour
    from .geometry import sort_outer_to_inner, sort_frez_outer_to_inner, sort_nearest_neighbour, simplify_contour
    from .toolpath import generate_toolpath
    from .gcode_writer import GCodeWriter
    from .validator import validate
    from .config import SCENARIOS, LAYER_CUT, LAYER_FREZ, LAYER_FREZ_135, LAYER_HOLES, build_tools_dict

    warnings = []

    # 1. Read DXF
    reader = DXFReader(dxf_path)
    bbox = reader.get_bounding_box()

    # 2. Detect scenario
    scenario_name = detect_scenario(reader.layers)

    # Build tools dict early so we can resolve custom_sequence
    tools = build_tools_dict(tool_overrides)

    # Determine which layers to prepare as CNC layers
    if custom_sequence:
        sequence_to_prepare = _resolve_custom_sequence(custom_sequence, tools)
    else:
        if scenario_name == "custom":
            raise ValueError("No standard CNC layers found and no custom sequence provided — cannot generate toolpath")
        sequence_to_prepare = SCENARIOS[scenario_name]

    prepared_contours = {}
    total_contours = 0

    for layer_name, tool_id in sequence_to_prepare:
        contours = reader.get_contours(layer_name)
        if not contours:
            warnings.append(f"Layer {layer_name} has no geometry — skipping")
            continue

        contours = [simplify_contour(c) for c in contours]
        total_contours += len(contours)
        prepared_contours[layer_name] = contours

    cnc_layers = {layer_name for layer_name, _ in sequence_to_prepare}
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

    # Determine the actual custom_sequence to pass to run_from_contours
    # Only layers that have geometry
    actual_sequence = [(l, t) for l, t in sequence_to_prepare if l in prepared_contours]
    serializable_sequence = [[l, t] for l, t in actual_sequence]

    result = run_from_contours(
        contours_by_layer=contours_by_layer,
        stock_bbox=stock_bbox_serial,
        scenario=scenario_name,
        algorithm=algorithm,
        original_filename=dxf_path if not original_filename else original_filename,
        tool_overrides=tool_overrides,
        custom_sequence=serializable_sequence if custom_sequence else None,
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
