# cnc_pipeline/validator.py
from dataclasses import dataclass, field
import re
from .dxf_reader import BBox

@dataclass
class ValidationResult:
    warnings: list[str] = field(default_factory=list)

def validate(nc_text: str, expected_tools: list[int], bbox: BBox) -> ValidationResult:
    result = ValidationResult()
    lines = nc_text.strip().split('\n')
    
    # Check program ends with M30
    if not any(line.endswith("M30") for line in lines[-5:]):
        result.warnings.append("Program does not appear to end with M30")

    # Check tools format
    tools_found = []
    for line in lines:
        m = re.search(r'T(\d+)M6', line)
        if m:
            tools_found.append(int(m.group(1)))
            
    if tools_found != expected_tools:
        result.warnings.append(f"Expected tools {expected_tools} but found {tools_found} in NC output")

    # Coolant matching
    m8_count = sum(1 for line in lines if "M8" in line)
    m9_count = sum(1 for line in lines if "M9" in line)
    if m8_count != m9_count:
        result.warnings.append(f"Mismatched coolant commands: {m8_count} M8 vs {m9_count} M9")

    # Depth bounds
    for i, line in enumerate(lines, 1):
        m = re.search(r'Z(-?\d+\.\d*)', line)
        if m:
            z_val = float(m.group(1))
            if z_val < -5.0:
                result.warnings.append(f"Line {i}: Z depth {z_val} is deeper than allowed (-5.0)")

    # X/Y Bounds (sheet + 35mm margin)
    for i, line in enumerate(lines, 1):
        x_m = re.search(r'X(-?\d+\.\d*)', line)
        y_m = re.search(r'Y(-?\d+\.\d*)', line)
        
        if x_m:
            x_val = float(x_m.group(1))
            if x_val < bbox.min_x - 35.0 or x_val > bbox.max_x + 35.0:
                result.warnings.append(f"Line {i}: X {x_val} is outside sheet margin")
        if y_m:
            y_val = float(y_m.group(1))
            if y_val < bbox.min_y - 35.0 or y_val > bbox.max_y + 35.0:
                result.warnings.append(f"Line {i}: Y {y_val} is outside sheet margin")

    # Sequential line numbers
    last_n = None
    for i, line in enumerate(lines, 1):
        m = re.match(r'^N(\d+)', line)
        if m:
            n = int(m.group(1))
            if last_n is not None and n <= last_n:
                result.warnings.append(f"Line {i}: Line number N{n} is not strictly increasing")
            last_n = n

    return result
