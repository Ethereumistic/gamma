import unittest
from cnc_pipeline.gcode_writer import GCodeWriter, fmt_coord, fmt_comment_number
from cnc_pipeline.toolpath import Move
from cnc_pipeline.dxf_reader import BBox

class TestGCodeWriter(unittest.TestCase):
    def test_fmt_coord(self):
        self.assertEqual(fmt_coord(175.0), "175.")
        self.assertEqual(fmt_coord(175.5), "175.5")
        self.assertEqual(fmt_coord(-4.1), "-4.1")

    def test_fmt_comment_number(self):
        self.assertEqual(fmt_comment_number(5.0), "5,000")
        self.assertEqual(fmt_comment_number(25.0, 1), "25,0")

    def test_full_write(self):
        writer = GCodeWriter("test")
        moves = [
            Move("rapid", x=0, y=0, z=None, feed=None),
            Move("plunge", x=None, y=None, z=-3.0, feed=550, coolant_on=True),
            Move("cut", x=10, y=0, z=None, feed=5500),
            Move("cut", x=10, y=10, z=None, feed=5500, coolant_off=True)
        ]
        text = writer.write([(9, "FREZ", moves)], BBox(0,0,10,10))
        lines = text.strip().split("\n")
        
        # Check first line is Tool Change
        self.assertEqual(lines[0], "N40T9M6")
        self.assertEqual(lines[1], "N50G54G90")
        
        # Check for M30 at the end
        if not lines[-1].endswith("M30"):
            print("LAST LINE:", lines[-1])
            print("FULL END:", lines[-5:])
        self.assertTrue(lines[-1].endswith("M30"))
        
        has_standalone_m9 = any(l.endswith("M9") for l in lines[-5:])
        if not has_standalone_m9:
            print("FULL END FOR M9:", lines[-5:])
        self.assertTrue(has_standalone_m9)
        
if __name__ == "__main__":
    unittest.main()
