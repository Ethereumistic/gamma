# tests/test_pipeline.py
import unittest
import os
from cnc_pipeline.pipeline import run_pipeline

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

if __name__ == "__main__":
    unittest.main()
