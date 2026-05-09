# tests/test_pipeline.py
import unittest
import os
from cnc_pipeline.pipeline import run_pipeline, run_from_contours

class TestPipelineIntegration(unittest.TestCase):
    def test_pipeline_with_real_example(self):
        dxf_path = "sample_files/Real-Example-DXF.dxf"
        if not os.path.exists(dxf_path):
            self.skipTest("Sample DXF not available")
            
        result = run_pipeline(dxf_path)
        
        # Verify stats
        self.assertEqual(result.scenario, "common") # HOLES, FREZ, CUT
        self.assertIn("CUT", result.layers_detected)
        self.assertEqual(result.tools_used, [7, 9, 7]) # Because HOLES uses 7, FREZ uses 9, CUT uses 7 based on most_common logic
        
        self.assertEqual(len(result.warnings), 0, "Pipeline produced warnings")
        
        self.assertTrue(result.nc_text.startswith("N40T7M6"))
        self.assertIn("M30", result.nc_text)

    def test_pipeline_with_custom_sequence(self):
        """Verify custom_sequence overrides the default SCENARIOS order."""
        dxf_path = "sample_files/Real-Example-DXF.dxf"
        if not os.path.exists(dxf_path):
            self.skipTest("Sample DXF not available")

        # Default order: HOLES(7) → FREZ(9) → CUT(7) for 'common' scenario
        default_result = run_pipeline(dxf_path)
        default_tools = default_result.tools_used
        self.assertEqual(default_tools, [7, 9, 7])

        # Custom order: FREZ(9) → HOLES(7) → CUT(7) (swap first two)
        custom_result = run_pipeline(
            dxf_path,
            custom_sequence=[["FREZ", 9], ["HOLES", 7], ["CUT", 7]],
        )
        custom_tools = custom_result.tools_used
        # tools_used reflects the actual toolpath block order, so T9 first
        self.assertEqual(custom_tools, [9, 7, 7], f"Expected [9, 7, 7] but got {custom_tools}")

        # The NC code should start with the first tool in the custom sequence
        self.assertTrue(
            custom_result.nc_text.startswith("N40T9M6"),
            f"Expected NC to start with T9M6 but got: {custom_result.nc_text[:20]}"
        )

        # The default order NC should start differently
        self.assertTrue(
            default_result.nc_text.startswith("N40T7M6"),
            f"Expected default NC to start with T7M6 but got: {default_result.nc_text[:20]}"
        )

        # The two NC programs must NOT be identical (different tool order)
        self.assertNotEqual(
            default_result.nc_text, custom_result.nc_text,
            "Custom sequence should produce different NC code than default"
        )


class TestRunFromContoursCustomSequence(unittest.TestCase):
    def test_custom_sequence_reorder(self):
        """Verify run_from_contours uses custom_sequence for toolpath order."""
        # Minimal contours_by_layer
        contours_by_layer = {
            "CUT": [{"points": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}, {"x": 0, "y": 10}], "is_closed": True}],
            "FREZ": [{"points": [{"x": 5, "y": 5}, {"x": 15, "y": 5}, {"x": 15, "y": 15}, {"x": 5, "y": 15}], "is_closed": True}],
        }
        stock_bbox = {"min_x": 0, "max_x": 20, "min_y": 0, "max_y": 20}

        # Default order (most_common: FREZ first)
        default_result = run_from_contours(
            contours_by_layer=contours_by_layer,
            stock_bbox=stock_bbox,
            scenario="most_common",
            algorithm="juggler_gemini",
        )
        self.assertEqual(default_result["tools_used"], [9, 7])  # FREZ(9) then CUT(7)

        # Custom order (CUT first)
        custom_result = run_from_contours(
            contours_by_layer=contours_by_layer,
            stock_bbox=stock_bbox,
            scenario="most_common",
            algorithm="juggler_gemini",
            custom_sequence=[["CUT", 7], ["FREZ", 9]],
        )
        self.assertEqual(custom_result["tools_used"], [7, 9])  # CUT(7) then FREZ(9)

        # NC code should differ
        self.assertNotEqual(default_result["nc_text"], custom_result["nc_text"])

    def test_custom_sequence_skips_missing_layers(self):
        """Custom sequence entries for layers not in contours_by_layer are skipped."""
        contours_by_layer = {
            "CUT": [{"points": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}, {"x": 0, "y": 10}], "is_closed": True}],
        }
        stock_bbox = {"min_x": 0, "max_x": 20, "min_y": 0, "max_y": 20}

        # Custom sequence includes FREZ which doesn't exist
        result = run_from_contours(
            contours_by_layer=contours_by_layer,
            stock_bbox=stock_bbox,
            scenario="most_common",
            algorithm="juggler_gemini",
            custom_sequence=[["FREZ", 9], ["CUT", 7]],
        )
        # FREZ is skipped (not in contours_by_layer), only CUT is processed
        self.assertEqual(result["tools_used"], [7])


if __name__ == "__main__":
    unittest.main()
