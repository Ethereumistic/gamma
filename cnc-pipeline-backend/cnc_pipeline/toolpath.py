# cnc_pipeline/toolpath.py
from .models import Point, Contour, Move
from typing import Literal
from .config import TOOLS, Z_CLEARANCE, Z_APPROACH

def generate_toolpath(
    contours: list[Contour],
    tool_num: int,
    layer_name: str,
    start_seq_index: int = 0
) -> tuple[list[Move], int]:
    if not contours:
        return [], start_seq_index

    tool = TOOLS[tool_num]
    plunge_feed = tool["feed_plunge"]
    cut_feed = tool["feed_cut"]
    depth = tool["layers"][layer_name]["depth"]

    moves = []
    current_seq_index = start_seq_index

    for i, contour in enumerate(contours):
        is_first_contour = (i == 0)
        start_pt = contour.points[0]
        
        if not is_first_contour:
            moves.append(Move("rapid", x=start_pt.x, y=start_pt.y, z=None, feed=None))
            moves.append(Move("rapid", x=None, y=None, z=Z_APPROACH, feed=None))
        else:
            moves.append(Move("rapid", x=start_pt.x, y=start_pt.y, z=None, feed=None))

        coolant_on = is_first_contour
        moves.append(Move("plunge", x=None, y=None, z=depth, feed=plunge_feed, coolant_on=coolant_on))

        for pt in contour.points[1:]:
            moves.append(Move("cut", x=pt.x, y=pt.y, z=None, feed=cut_feed, seq_index=current_seq_index))
            current_seq_index += 1

        if contour.is_closed:
            moves.append(Move("cut", x=start_pt.x, y=start_pt.y, z=None, feed=cut_feed, seq_index=current_seq_index))
            current_seq_index += 1

        moves.append(Move("retract", x=None, y=None, z=Z_CLEARANCE, feed=None))

    return moves, current_seq_index
