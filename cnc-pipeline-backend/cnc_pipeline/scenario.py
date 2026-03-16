# cnc_pipeline/scenario.py

def detect_scenario(dxf_layers: set[str]) -> str:
    has_holes    = "HOLES"    in dxf_layers
    has_frez     = "FREZ"     in dxf_layers
    has_frez_135 = "FREZ_135" in dxf_layers
    has_cut      = "CUT"      in dxf_layers

    if not has_cut:
        raise ValueError("DXF has no CUT layer — cannot generate toolpath")

    if has_holes and has_frez and has_frez_135:
        return "very_rare"      # HOLES > FREZ > FREZ_135 > CUT
    if has_holes and has_frez:
        return "common"         # HOLES > FREZ > CUT
    if has_frez and has_frez_135:
        return "rare"           # FREZ > FREZ_135 > CUT
    if has_frez:
        return "most_common"    # FREZ > CUT
    return "cut_only"           # edge case — CUT only
