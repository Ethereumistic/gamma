# tests/test_dxf_reader.py
import unittest
import ezdxf
import tempfile
import os
from cnc_pipeline.dxf_reader import DXFReader

class TestDXFReader(unittest.TestCase):
    def setUp(self):
        # Create a temporary DXF file for testing
        self.doc = ezdxf.new()
        self.msp = self.doc.modelspace()
        
        # Add basic test geometries
        self.msp.add_line((0, 0), (10, 0), dxfattribs={'layer': 'CUT'})
        self.msp.add_circle((5, 5), 5, dxfattribs={'layer': 'HOLES'})
        self.msp.add_lwpolyline([(0, 0), (0, 10), (10, 10)], dxfattribs={'layer': 'FREZ'})

        self.fd, self.filepath = tempfile.mkstemp(suffix=".dxf")
        os.close(self.fd)
        self.doc.saveas(self.filepath)
        
        self.reader = DXFReader(self.filepath)

    def tearDown(self):
        os.unlink(self.filepath)

    def test_layers_detected(self):
        self.assertIn("CUT", self.reader.layers)
        self.assertIn("HOLES", self.reader.layers)
        self.assertIn("FREZ", self.reader.layers)

    def test_get_contours_line(self):
        contours = self.reader.get_contours("CUT")
        self.assertEqual(len(contours), 1)
        self.assertAlmostEqual(contours[0].points[0].x, 0.0)
        self.assertAlmostEqual(contours[0].points[-1].x, 10.0)
        self.assertFalse(contours[0].is_closed)

    def test_get_contours_polyline(self):
        contours = self.reader.get_contours("FREZ")
        self.assertEqual(len(contours), 1)
        self.assertEqual(len(contours[0].points), 3)
        self.assertFalse(contours[0].is_closed)

    def test_get_contours_circle(self):
        contours = self.reader.get_contours("HOLES")
        self.assertEqual(len(contours), 1)
        self.assertTrue(contours[0].is_closed)
        self.assertGreater(len(contours[0].points), 10)  # Circle is discretized

    def test_get_bounding_box(self):
        bbox = self.reader.get_bounding_box()
        self.assertAlmostEqual(bbox.min_x, 0.0)
        self.assertAlmostEqual(bbox.min_y, 0.0)
        self.assertAlmostEqual(bbox.max_x, 10.0)
        self.assertAlmostEqual(bbox.max_y, 10.0)

if __name__ == "__main__":
    unittest.main()
