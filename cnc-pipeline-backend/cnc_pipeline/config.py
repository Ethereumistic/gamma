# cnc_pipeline/config.py

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

# ── G-code line numbering ─────────────────────────────────────────────────────
LINE_NUM_START     = 40    # first line in output (after tape-start lines are stripped)
LINE_NUM_INCREMENT = 10    # every line +10
LINE_NUM_GAP       = 40    # gap between last move of one toolpath and TxM6 of next
                           # (accounts for 4 deleted inter-toolpath lines × 10)
