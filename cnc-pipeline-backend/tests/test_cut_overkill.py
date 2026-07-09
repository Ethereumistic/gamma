import os
import tempfile
import unittest

import ezdxf

from cnc_pipeline.cut_overkill import dedupe_segments, process_file


def norm_segments(segments):
    normalized = []
    for a, b in segments:
        if b < a:
            a, b = b, a
        normalized.append((a, b))
    return sorted(normalized)


class TestCutOverkill(unittest.TestCase):
    def test_exact_duplicate_line_same_direction(self):
        result = dedupe_segments([((0, 0), (10, 0)), ((0, 0), (10, 0))])
        self.assertEqual(norm_segments(result), [((0.0, 0.0), (10.0, 0.0))])

    def test_exact_duplicate_line_reversed_direction(self):
        result = dedupe_segments([((0, 0), (10, 0)), ((10, 0), (0, 0))])
        self.assertEqual(norm_segments(result), [((0.0, 0.0), (10.0, 0.0))])

    def test_partial_overlap_is_split_into_atomic_spans_once(self):
        result = dedupe_segments([((0, 0), (100, 0)), ((50, 0), (150, 0))])
        self.assertEqual(norm_segments(result), [
            ((0.0, 0.0), (50.0, 0.0)),
            ((50.0, 0.0), (100.0, 0.0)),
            ((100.0, 0.0), (150.0, 0.0)),
        ])

    def test_touching_end_to_end_segments_do_not_merge_or_delete(self):
        result = dedupe_segments([((0, 0), (10, 0)), ((10, 0), (20, 0))])
        self.assertEqual(norm_segments(result), [
            ((0.0, 0.0), (10.0, 0.0)),
            ((10.0, 0.0), (20.0, 0.0)),
        ])

    def test_diagonal_overlap(self):
        result = dedupe_segments([((0, 0), (10, 10)), ((5, 5), (15, 15))])
        self.assertEqual(norm_segments(result), [
            ((0.0, 0.0), (5.0, 5.0)),
            ((5.0, 5.0), (10.0, 10.0)),
            ((10.0, 10.0), (15.0, 15.0)),
        ])

    def test_process_file_preserves_non_cut_and_unsupported_cut_entities(self):
        doc = ezdxf.new()
        msp = doc.modelspace()
        msp.add_line((0, 0), (10, 0), dxfattribs={"layer": "CUT"})
        msp.add_line((0, 0), (10, 0), dxfattribs={"layer": "CUT"})
        msp.add_circle((5, 5), 1, dxfattribs={"layer": "CUT"})
        msp.add_line((1, 1), (2, 2), dxfattribs={"layer": "FREZ"})

        input_path, output_path = self._temp_paths()
        try:
            doc.saveas(input_path)
            report = process_file(input_path, output_path)
            out = ezdxf.readfile(output_path).modelspace()
            cut_supported = [e for e in out if e.dxftype() in {"LINE", "LWPOLYLINE", "POLYLINE"} and e.dxf.layer == "CUT"]
            frez_lines = [e for e in out if e.dxftype() == "LINE" and e.dxf.layer == "FREZ"]
            cut_circles = [e for e in out if e.dxftype() == "CIRCLE" and e.dxf.layer == "CUT"]
            self.assertEqual(len(cut_supported), 1)
            self.assertEqual(len(frez_lines), 1)
            self.assertEqual(len(cut_circles), 1)
            self.assertEqual(report.source_entities_removed, 2)
            self.assertEqual(report.unsupported_cut_entities_preserved, 1)
            self.assertEqual(report.unsupported_types, ["CIRCLE"])
        finally:
            self._cleanup(input_path, output_path)

    def test_closed_adjacent_rectangles_lwpolyline_shared_edge_deduped(self):
        doc = ezdxf.new()
        msp = doc.modelspace()
        msp.add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=True, dxfattribs={"layer": "CUT"})
        msp.add_lwpolyline([(10, 0), (20, 0), (20, 10), (10, 10)], close=True, dxfattribs={"layer": "CUT"})

        input_path, output_path = self._temp_paths()
        try:
            doc.saveas(input_path)
            report = process_file(input_path, output_path)
            out = ezdxf.readfile(output_path).modelspace()
            cut_entities = [e for e in out if e.dxf.layer == "CUT"]
            self.assertEqual(report.source_segments, 8)
            self.assertEqual(report.deduped_segments, 7)
            self.assertLess(len(cut_entities), 7)
            self.assertTrue(any(e.dxftype() in {"LWPOLYLINE", "POLYLINE"} for e in cut_entities))
        finally:
            self._cleanup(input_path, output_path)

    def test_classic_polyline_input(self):
        doc = ezdxf.new("R12")
        msp = doc.modelspace()
        msp.add_polyline2d([(0, 0), (10, 0), (10, 10)], close=True, dxfattribs={"layer": "CUT"})

        input_path, output_path = self._temp_paths()
        try:
            doc.saveas(input_path)
            report = process_file(input_path, output_path)
            self.assertEqual(report.source_segments, 3)
            self.assertEqual(report.deduped_segments, 3)
        finally:
            self._cleanup(input_path, output_path)

    def _temp_paths(self):
        fd_in, input_path = tempfile.mkstemp(suffix=".dxf")
        fd_out, output_path = tempfile.mkstemp(suffix=".dxf")
        os.close(fd_in)
        os.close(fd_out)
        return input_path, output_path

    def _cleanup(self, *paths):
        for path in paths:
            if os.path.exists(path):
                os.unlink(path)


if __name__ == "__main__":
    unittest.main()
