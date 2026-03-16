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

    def test_get_entities_line(self):
        segments = self.reader.get_entities("CUT")
        self.assertEqual(len(segments), 1)
        self.assertAlmostEqual(segments[0].start.x, 0.0)
        self.assertAlmostEqual(segments[0].end.x, 10.0)

    def test_get_entities_polyline(self):
        segments = self.reader.get_entities("FREZ")
        self.assertEqual(len(segments), 2)  # Two line segments

    def test_get_entities_circle(self):
        segments = self.reader.get_entities("HOLES")
        self.assertGreater(len(segments), 10)  # Circle is discretized

    def test_get_bounding_box(self):
        bbox = self.reader.get_bounding_box()
        self.assertAlmostEqual(bbox.min_x, 0.0)
        self.assertAlmostEqual(bbox.min_y, 0.0)
        self.assertAlmostEqual(bbox.max_x, 10.0)
        self.assertAlmostEqual(bbox.max_y, 10.0)

if __name__ == "__main__":
    unittest.main()
