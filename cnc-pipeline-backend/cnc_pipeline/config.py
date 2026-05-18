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
# Keyed by unique tool ID — multiple tools CAN share the same pocket number.
TOOLS: dict[str, dict] = {
    "prav": {
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
    "trapec_105": {
        "id":           "trapec_105",
        "name":         "Tapered Tipped",
        "number":       9,
        "diameter":     13.0,
        "tip_radius":   0.0,
        "taper_angle":  47.5,
        "taper_height": 3.15,
        "gauge_length": 50.0,
        "flutes":       4,
        "spindle_rpm":  13000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "FREZ": {"depth": -3.0, "offset": 0.0},
        },
    },
    "trapec_135": {
        "id":           "trapec_135",
        "name":         "Tapered Tipped",
        "number":       11,
        "diameter":     13.0,
        "tip_radius":   0.0,
        "taper_angle":  47.5,
        "taper_height": 3.15,
        "gauge_length": 50.0,
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
# Each scenario is an ordered list of (layer_name, tool_id) tuples
SCENARIOS: dict[str, list[tuple[str, str]]] = {
    "most_common": [
        ("FREZ",  "trapec_105"),
        ("CUT",   "prav"),
    ],
    "common": [
        ("HOLES", "prav"),
        ("FREZ",  "trapec_105"),
        ("CUT",   "prav"),
    ],
    "rare": [
        ("FREZ",     "trapec_105"),
        ("FREZ_135", "trapec_135"),
        ("CUT",      "prav"),
    ],
    "very_rare": [
        ("HOLES",    "prav"),
        ("FREZ",     "trapec_105"),
        ("FREZ_135", "trapec_135"),
        ("CUT",      "prav"),
    ],
    "cut_only": [
        ("CUT", "prav"),
    ],
}

# ── Layer → default tool mapping ────────────────────────────────────────────────
LAYER_TOOL_MAP: dict[str, str] = {
    "CUT":      "prav",
    "HOLES":    "prav",
    "FREZ":     "trapec_105",
    "FREZ_135": "trapec_135",
}

# ── Default layer config for custom/ad-hoc layers ────────────────────────────────
DEFAULT_LAYER_CONFIG = {"depth": -3.0, "offset": 0.0}

# ── G-code line numbering ─────────────────────────────────────────────────────
LINE_NUM_START     = 40
LINE_NUM_INCREMENT = 10
LINE_NUM_GAP       = 40


# ── Override-aware tool builder ───────────────────────────────────────────────
def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge *override* into a copy of *base*."""
    result = copy.deepcopy(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        elif isinstance(val, dict):
            result[key] = copy.deepcopy(val)
        elif isinstance(val, (int, float)):
            result[key] = val
    return result


def _migrate_number_key(key: str, defaults: dict[str, dict]) -> str:
    """Migrate an old number-keyed override key to the new id-based key."""
    if key in defaults:
        return key
    try:
        num = int(key)
        for tool_id, tool in defaults.items():
            if tool["number"] == num:
                return tool_id
    except (ValueError, TypeError):
        pass
    return key


def build_tools_dict(overrides: dict | None = None) -> dict[str, dict]:
    """Return the TOOLS dict with optional sparse overrides deep-merged,
    plus any custom tools defined in overrides.

    Accepts both new id-keyed and legacy number-keyed overrides:
      - New: ``{ "prav": { "feed_cut": 6000 } }``
      - Old: ``{ "7": { "feed_cut": 6000 } }`` (auto-migrated to id)

    Custom tools (tool IDs not in TOOLS) are included as full definitions.
    A custom tool override must contain at least "number", "id", "name" keys.
    """
    if not overrides:
        return TOOLS

    result: dict[str, dict] = {}

    # Migrate old number-keyed overrides to id-keyed
    migrated: dict[str, dict] = {}
    for key, val in overrides.items():
        new_key = _migrate_number_key(key, TOOLS)
        if new_key in migrated and isinstance(migrated[new_key], dict) and isinstance(val, dict):
            migrated[new_key] = {**migrated[new_key], **val}
        else:
            migrated[new_key] = val

    # 1. Merge built-in tools with overrides
    for tool_id, base_tool in TOOLS.items():
        if tool_id in migrated and isinstance(migrated[tool_id], dict):
            result[tool_id] = _deep_merge(base_tool, migrated[tool_id])
        else:
            result[tool_id] = base_tool

    # 2. Add custom tools (tool IDs not in TOOLS)
    for tool_key, tool_override in migrated.items():
        if tool_key in TOOLS:
            continue  # already handled above
        if isinstance(tool_override, dict) and "number" in tool_override:
            result[tool_key] = copy.deepcopy(tool_override)

    return result
