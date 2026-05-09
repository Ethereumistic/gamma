# cnc_pipeline/config.py

import copy
from dataclasses import dataclass
from typing import Literal

# ── Cutting heights ────────────────────────────────────────────────────────────
Z_CLEARANCE  = 10.0   # retract height after each contour  (G0Z10.)
Z_APPROACH   = 5.0    # approach height before plunge      (Z5. on first rapid)
Z_SAFE_RAPID = 5.0    # Z on the G43G0 first move line

# ── Stock expansion (PowerMill equivalent) ────────────────────────────────────
STOCK_EXPANSION = 9.0  # mm added on each side for bounding box in NC header

# ── Tool definitions ──────────────────────────────────────────────────────────
TOOLS: dict[int, dict] = {
    7: {
        "id":           "prav",
        "name":         "End Mill",
        "number":       7,
        "diameter":     6.0,
        "gauge_length": 25.0,
        "flutes":       1,
        "spindle_rpm":  24000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "CUT":   {"depth": -4.1,  "offset": 3.0},
            "HOLES": {"depth": -4.11, "offset": 0.0},
        },
    },
    9: {
        "id":           "trapec_105",
        "name":         "Tapered Tipped",
        "number":       9,
        "diameter":     13.0,
        "tip_radius":   0.0,
        "taper_angle":  47.5,
        "taper_height": 3.15,
        "gauge_length": 50.0,   # confirmed from NC file comment block
        "flutes":       4,
        "spindle_rpm":  13000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "FREZ": {"depth": -3.0, "offset": 0.0},
        },
    },
    11: {
        "id":           "trapec_135",
        "name":         "Tapered Tipped",
        "number":       11,
        "diameter":     13.0,
        "tip_radius":   0.0,
        "taper_angle":  47.5,
        "taper_height": 3.15,
        "gauge_length": 50.0,   # assumed same as T9 — verify with tool database
        "flutes":       4,
        "spindle_rpm":  13000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "FREZ_135": {"depth": -3.0, "offset": 0.0},
        },
    },
}

# ── Layer names (case-sensitive, must match DXF exactly) ──────────────────────
LAYER_CUT      = "CUT"
LAYER_FREZ     = "FREZ"
LAYER_FREZ_135 = "FREZ_135"
LAYER_HOLES    = "HOLES"
LAYER_SHEETS   = "SHEETS"
LAYER_DEFAULT  = "0"

# ── Scenario definitions ──────────────────────────────────────────────────────
# Each scenario is an ordered list of (layer_name, tool_number) tuples
SCENARIOS: dict[str, list[tuple[str, int]]] = {
    "most_common": [
        ("FREZ",  9),
        ("CUT",   7),
    ],
    "common": [
        ("HOLES", 7),
        ("FREZ",  9),
        ("CUT",   7),
    ],
    "rare": [
        ("FREZ",     9),
        ("FREZ_135", 11),
        ("CUT",      7),
    ],
    "very_rare": [
        ("HOLES",    7),
        ("FREZ",     9),
        ("FREZ_135", 11),
        ("CUT",      7),
    ],
    "cut_only": [
        ("CUT", 7),
    ],
}

# ── Layer → default tool mapping ────────────────────────────────────────────────
# Used to build custom sequences when the user reorders layers.
# Each CNC layer is always cut by exactly one tool.
LAYER_TOOL_MAP: dict[str, int] = {
    "CUT":      7,
    "HOLES":    7,
    "FREZ":     9,
    "FREZ_135": 11,
}

# ── G-code line numbering ─────────────────────────────────────────────────────
LINE_NUM_START     = 40    # first line in output (after tape-start lines are stripped)
LINE_NUM_INCREMENT = 10    # every line +10
LINE_NUM_GAP       = 40    # gap between last move of one toolpath and TxM6 of next
                           # (accounts for 4 deleted inter-toolpath lines × 10)


# ── Override-aware tool builder ───────────────────────────────────────────────
def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge *override* into a copy of *base*.
    Only merges dicts and numeric leaf values — everything else is ignored."""
    result = copy.deepcopy(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        elif isinstance(val, (int, float)):
            result[key] = val
    return result


def build_tools_dict(overrides: dict | None = None) -> dict[int, dict]:
    """Return the TOOLS dict with optional sparse overrides deep-merged.

    *overrides* shape: ``{ "7": { "feed_cut": 6000, "layers": { "CUT": { "depth": -4.4 } } } }``
    Keys are tool numbers as strings.  Only numeric leaf values are applied;
    structural keys (id, name, number) are never overridden.

    When *overrides* is ``None`` or empty, the original ``TOOLS`` dict is
    returned unchanged (same object identity — no copy).
    """
    if not overrides:
        return TOOLS

    result: dict[int, dict] = {}
    for tool_num, base_tool in TOOLS.items():
        tool_key = str(tool_num)
        if tool_key in overrides and isinstance(overrides[tool_key], dict):
            result[tool_num] = _deep_merge(base_tool, overrides[tool_key])
        else:
            result[tool_num] = base_tool
    return result
