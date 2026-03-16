# cnc_pipeline/gcode_writer.py
from dataclasses import dataclass
import math
from .config import TOOLS, STOCK_EXPANSION, LINE_NUM_START, LINE_NUM_INCREMENT, LINE_NUM_GAP
from .dxf_reader import BBox
from .toolpath import Move

def fmt_coord(value: float) -> str:
    rounded = round(value, 3)
    if rounded == int(rounded):
        return f"{int(rounded)}."
    s = f"{rounded:.3f}".rstrip("0")
    if s.endswith("."):
        return s
    return s

def fmt_int(value: int) -> str:
    return str(int(value))

def fmt_comment_number(value: float, decimal_places: int = 3) -> str:
    s = f"{value:.{decimal_places}f}"
    return s.replace(".", ",")

class LineCounter:
    def __init__(self, start=LINE_NUM_START, increment=LINE_NUM_INCREMENT):
        self._n = start
        self._increment = increment

    def next(self) -> str:
        val = self._n
        self._n += self._increment
        return f"N{val}"

    def skip(self, count: int):
        self._n += self._increment * count

    def gap(self):
        self.skip(4)

class GCodeWriter:
    def __init__(self, program_name: str):
        self.program_name = program_name
        self.total_path_length = 0.0

    def write(self, toolpath_blocks: list[tuple[int, str, list[Move]]], bbox: BBox) -> str:
        counter = LineCounter()
        lines = []
        
        # We need to maintain state across all blocks since first rapid uses previous toolpath's last position
        machine_x = None
        machine_y = None
        
        for index, block in enumerate(toolpath_blocks, start=1):
            tool_num, layer_name, moves = block
            tool = TOOLS[tool_num]
            is_final_toolpath = (index == len(toolpath_blocks))
            
            # Pre-calculate stats for comment block
            path_len = 0.0
            retract_count = sum(1 for m in moves if m.type == "retract")
            sim_x, sim_y, sim_z = (machine_x or 0.0), (machine_y or 0.0), 10.0
            
            for m in moves:
                dx = (m.x - sim_x) if m.x is not None else 0.0
                dy = (m.y - sim_y) if m.y is not None else 0.0
                dz = (m.z - sim_z) if m.z is not None else 0.0
                dist = math.sqrt(dx*dx + dy*dy + dz*dz)
                path_len += dist
                if m.x is not None: sim_x = m.x
                if m.y is not None: sim_y = m.y
                if m.z is not None: sim_z = m.z
                
            self.total_path_length += path_len
            est_time_sec = (path_len / 5500.0) * 60.0
            h = int(est_time_sec // 3600)
            m_rem = int((est_time_sec % 3600) // 60)
            s_rem = int(est_time_sec % 60)
            time_str = f"{h}/{m_rem:02d}/{s_rem:02d}"

            # Ensure we have start coordinates for the first rapid
            first_x = moves[0].x if moves else 0.0
            first_y = moves[0].y if moves else 0.0
            
            if machine_x is None:
                rapid_start_x = first_x
                rapid_start_y = first_y
            else:
                rapid_start_x = machine_x
                rapid_start_y = machine_y
                
            # Form header
            lines.append(f"{counter.next()}T{tool['number']}M6")
            lines.append(f"{counter.next()}G54G90")
            
            # Comment block
            def add_comment(s): lines.append(f"{counter.next()}( {s})")
            
            add_comment(f"Toolpath Name: {index}")
            add_comment(f"Output:")
            add_comment(f"Units: MM")
            add_comment(f"Tool Coordinates: Tip")
            add_comment(f"Tool Number: {tool['number']}")
            add_comment(f"Tool Id: {tool['id']}")
            add_comment(f"Coolant: Standard")
            add_comment(f"Gauge Length: {fmt_comment_number(tool['gauge_length'], 1)}")
            add_comment(f"Block:")
            add_comment(f"MIN X: {fmt_comment_number(bbox.min_x - STOCK_EXPANSION)}")
            add_comment(f"MIN Y: {fmt_comment_number(bbox.min_y - STOCK_EXPANSION)}")
            add_comment(f"MIN Z: -9,000")
            add_comment(f"MAX X: {fmt_comment_number(bbox.max_x + STOCK_EXPANSION)}")
            add_comment(f"MAX Y: {fmt_comment_number(bbox.max_y + STOCK_EXPANSION)}")
            add_comment(f"MAX Z: 9,000")
            add_comment(f"COORDINATE SYSTEM: Named Workplane")
            add_comment(f"Datum - Tool Tip:")
            add_comment(f"  X: {fmt_comment_number(rapid_start_x)}")
            add_comment(f"  Y: {fmt_comment_number(rapid_start_y)}")
            add_comment(f"  Z: 10,000")
            add_comment(f"Number of Flutes: {fmt_int(tool['flutes'])}")
            add_comment(f"Tool:   {tool['name']}")
            add_comment(f"DIAMETER: {fmt_comment_number(tool['diameter'])}")
            if "taper_angle" in tool:
                add_comment(f"TIP RADIUS: {fmt_comment_number(tool['tip_radius'])}")
                add_comment(f"TAPER ANGLE: {fmt_comment_number(tool['taper_angle'])}")
                add_comment(f"TAPER HEIGHT: {fmt_comment_number(tool['taper_height'])}")
            add_comment("Safety:")
            add_comment("Tool Cutting Moves: Gouges Not Checked")
            add_comment("Tool Leads: Safe No Gouges")
            add_comment("Tool Links: Gouges Not Checked")
            add_comment("Holder Cutting Moves: Collisions Not Checked")
            add_comment("Holder Leads: Collisions Not Checked")
            add_comment("Holder Links: Collisions Not Checked")
            add_comment("Toolpath: Curve Profile Machining")
            add_comment("STEPOVER: 5,000")
            add_comment("TOLERANCE:0,100")
            add_comment("THICKNESS:1,000")
            add_comment("Toolpath Stats:")
            add_comment(f"LENGTH: {fmt_comment_number(path_len)}")
            add_comment(f"TIME: {time_str}")
            add_comment(f"LIFTS: {retract_count}")
            
            # Moves
            cur_g = None
            cur_f = None
            cur_x = None
            cur_y = None
            cur_z = None
            
            # First rapid
            cmd_rapid = f"{counter.next()}G43G0"
            if rapid_start_x is not None:
                cmd_rapid += f"X{fmt_coord(rapid_start_x)}"
            if rapid_start_y is not None:
                cmd_rapid += f"Y{fmt_coord(rapid_start_y)}"
            cmd_rapid += f"Z5.S{fmt_int(tool['spindle_rpm'])}H{tool['number']}M3"
            lines.append(cmd_rapid)
            
            cur_g = 0
            cur_x = rapid_start_x
            cur_y = rapid_start_y
            cur_z = 5.0
            
            for m_idx, m in enumerate(moves):
                parts = [counter.next()]
                target_g = 0 if m.type in ("rapid", "retract") else 1
                
                if target_g != cur_g:
                    parts.append(f"G{target_g}")
                    cur_g = target_g
                    
                added_coords = False
                if m.x is not None and (cur_x is None or abs(m.x - cur_x) > 0.0001):
                    parts.append(f"X{fmt_coord(m.x)}")
                    cur_x = m.x
                    added_coords = True
                    
                if m.y is not None and (cur_y is None or abs(m.y - cur_y) > 0.0001):
                    parts.append(f"Y{fmt_coord(m.y)}")
                    cur_y = m.y
                    added_coords = True
                    
                if m.z is not None and (cur_z is None or abs(m.z - cur_z) > 0.0001):
                    parts.append(f"Z{fmt_coord(m.z)}")
                    cur_z = m.z
                    
                if m.coolant_on:
                    parts.append("M8")
                    
                # coolant off combined logic inside block moves? Wait
                # The manual coolant off is appended on last move.
                
                if m.feed is not None and (cur_f is None or abs(m.feed - cur_f) > 0.0001):
                    parts.append(f"F{fmt_int(m.feed)}")
                    cur_f = m.feed
                
                line_str = "".join(parts)
                
                is_last_move = (m_idx == len(moves) - 1)
                
                if m.coolant_off and not is_final_toolpath:
                    # In spec: "For non-final toolpaths: last line is NxxX{x}Y{y}M9"
                    # We just append M9
                    line_str += "M9"
                    lines.append(line_str)
                elif m.coolant_off and is_final_toolpath:
                    lines.append(line_str)
                    # For final toolpath, M9 goes on its own line after the last XY
                    lines.append(f"{counter.next()}M9")
                elif len(parts) > 1: # don't emit line if NO variable changed (except N)
                    lines.append(line_str)
                    
            machine_x = cur_x
            machine_y = cur_y
            
            if not is_final_toolpath:
                counter.gap()
            else:
                lines.append(f"{counter.next()}G91G28Z0")
                lines.append(f"{counter.next()}G49H0")
                lines.append(f"{counter.next()}G28X0Y0")
                lines.append(f"{counter.next()}M30")
                
        return "\n".join(lines) + "\n"
