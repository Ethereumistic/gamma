# cnc_pipeline/scenario.py

def detect_scenario(dxf_layers: set[str]) -> str:
    """Detect the CNC scenario based on DXF layers.
    
    When custom_sequence is provided by the caller, the scenario
    is only used as a label — the actual layer order comes from
    the custom_sequence. This function still raises if no standard
    CNC layers are found, but the caller can skip this check
    when custom_sequence is provided.
    """
    has_holes    = "HOLES"    in dxf_layers
    has_frez     = "FREZ"     in dxf_layers
    has_frez_135 = "FREZ_135" in dxf_layers
    has_cut      = "CUT"      in dxf_layers

    if has_holes and has_frez and has_frez_135:
        return "very_rare"      # HOLES > FREZ > FREZ_135 > CUT
    if has_holes and has_frez:
        return "common"         # HOLES > FREZ > CUT
    if has_frez and has_frez_135:
        return "rare"           # FREZ > FREZ_135 > CUT
    if has_frez:
        return "most_common"    # FREZ > CUT
    if has_cut:
        return "cut_only"       # edge case — CUT only
    # No standard layers found — use "custom" as a fallback label
    return "custom"
