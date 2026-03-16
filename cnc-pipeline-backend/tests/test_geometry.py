# tests/test_geometry.py
import unittest
from cnc_pipeline.dxf_reader import Point, Segment, BBox
from cnc_pipeline.geometry import join_segments, sort_outer_to_inner, sort_nearest_neighbour

class TestGeometry(unittest.TestCase):
    def test_join_segments(self):
        # A simple square broken into 4 segments
        s1 = Segment(Point(0,0), Point(10,0), "CUT")
        s2 = Segment(Point(10,10), Point(10,0), "CUT") # Note reversed direction
        s3 = Segment(Point(10,10), Point(0,10), "CUT")
        s4 = Segment(Point(0,0), Point(0,10), "CUT")
        
        segments = [s1, s2, s3, s4]
        contours = join_segments(segments)
        
        self.assertEqual(len(contours), 1)
        self.assertTrue(contours[0].is_closed)
        self.assertEqual(len(contours[0].points), 4) # 4 distinct points in a closed square

    def test_join_open_segments(self):
        s1 = Segment(Point(0,0), Point(10,0), "FREZ")
        s2 = Segment(Point(10,0), Point(20,0), "FREZ")
        
        contours = join_segments([s1, s2])
        self.assertEqual(len(contours), 1)
        self.assertFalse(contours[0].is_closed)
        self.assertEqual(len(contours[0].points), 3)

    def test_sort_outer_to_inner(self):
        # Center of sheet is 50, 50 (based on bbox 0..100)
        c1 = Segment(Point(90,90), Point(90,100), "FREZ") # Far from center
        c2 = Segment(Point(50,50), Point(51,51), "FREZ") # Close to center
        contours = join_segments([c1, c2])
        
        bbox = BBox(0, 0, 100, 100)
        sorted_c = sort_outer_to_inner(contours, bbox)
        
        self.assertEqual(sorted_c[0].points[0].x, 90) # The one further away should be first

    def test_sort_nearest_neighbour(self):
        # Three holes
        h1 = Segment(Point(50,50), Point(50,50.1), "HOLES")
        h2 = Segment(Point(10,10), Point(10,10.1), "HOLES")
        h3 = Segment(Point(20,20), Point(20,20.1), "HOLES")
        contours = join_segments([h1, h2, h3])
        
        sorted_c = sort_nearest_neighbour(contours)
        # Should start from (0,0) so h2 is closest first, then h3, then h1
        self.assertEqual(sorted_c[0].points[0].x, 10)
        self.assertEqual(sorted_c[1].points[0].x, 20)
        self.assertEqual(sorted_c[2].points[0].x, 50)

if __name__ == "__main__":
    unittest.main()
