# tests/test_toolpath.py
import unittest
from cnc_pipeline.models import Point, Contour, Move
from cnc_pipeline.toolpath import generate_toolpath

class TestToolpath(unittest.TestCase):
    def test_single_contour(self):
        c1 = Contour([Point(0,0), Point(10,0), Point(10,10), Point(0,10)], is_closed=True)
        
        # Tool 9, layer "FREZ"
        moves = generate_toolpath([c1], 9, "FREZ")
        
        # Structure should be:
        # Rapid (0,0) -> Plunge -> 4 cuts -> Retract
        self.assertEqual(len(moves), 7)
        self.assertEqual(moves[0].type, "rapid")
        self.assertEqual(moves[0].x, 0)
        self.assertEqual(moves[0].y, 0)
        
        self.assertEqual(moves[1].type, "plunge")
        self.assertEqual(moves[1].z, -3.0)
        self.assertTrue(moves[1].coolant_on)
        self.assertEqual(moves[1].feed, 550)
        
        self.assertEqual(moves[2].type, "cut")
        self.assertEqual(moves[2].x, 10)
        self.assertEqual(moves[2].feed, 5500)
        
        self.assertEqual(moves[-1].type, "retract")
        self.assertEqual(moves[-1].z, 10.0)

    def test_multiple_contours(self):
        c1 = Contour([Point(0,0), Point(10,0)], is_closed=False)
        c2 = Contour([Point(20,20), Point(30,20)], is_closed=False)
        
        moves = generate_toolpath([c1, c2], 7, "CUT")
        
        # C1: Rapid(0,0), Plunge, Cut, Retract (4)
        # C2: Rapid(20,20), RapidZ(5.0), Plunge, Cut, Retract (5)
        self.assertEqual(len(moves), 9)
        self.assertEqual(moves[4].type, "rapid")
        self.assertEqual(moves[4].x, 20)
        self.assertEqual(moves[4].y, 20)
        
        self.assertEqual(moves[5].type, "rapid")
        self.assertEqual(moves[5].z, 5.0)
        self.assertFalse(moves[5].coolant_on) # coolant already on

if __name__ == "__main__":
    unittest.main()
