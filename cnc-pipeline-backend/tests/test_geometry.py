# tests/test_geometry.py
import unittest
from cnc_pipeline.models import Point, BBox, Contour
from cnc_pipeline.geometry import simplify_contour, sort_outer_to_inner, sort_nearest_neighbour

class TestGeometry(unittest.TestCase):
    def test_simplify_contour(self):
        # Three collinear points
        p1 = Point(0, 0)
        p2 = Point(5, 0)
        p3 = Point(10, 0)
        contour = Contour([p1, p2, p3], False)
        
        simplified = simplify_contour(contour)
        self.assertEqual(len(simplified.points), 2)
        self.assertEqual(simplified.points[0], p1)
        self.assertEqual(simplified.points[1], p3)

    def test_sort_outer_to_inner(self):
        # Center of sheet is 50, 50 (based on bbox 0..100)
        c1 = Contour([Point(90,90), Point(90,100)], False) # Far from center
        c2 = Contour([Point(50,50), Point(51,51)], False) # Close to center
        
        bbox = BBox(0, 0, 100, 100)
        sorted_c = sort_outer_to_inner([c1, c2], bbox)
        
        self.assertEqual(sorted_c[0].points[0].x, 90) # The one further away should be first

    def test_sort_nearest_neighbour(self):
        # Three holes (represented as small open contours for simplicity in test)
        h1 = Contour([Point(50,50), Point(50,50.1)], False)
        h2 = Contour([Point(10,10), Point(10,10.1)], False)
        h3 = Contour([Point(20,20), Point(20,20.1)], False)
        
        sorted_c = sort_nearest_neighbour([h1, h2, h3])
        # Should start from (0,0) so h2 is closest first, then h3, then h1
        self.assertEqual(sorted_c[0].points[0].x, 10)
        self.assertEqual(sorted_c[1].points[0].x, 20)
        self.assertEqual(sorted_c[2].points[0].x, 50)

if __name__ == "__main__":
    unittest.main()
