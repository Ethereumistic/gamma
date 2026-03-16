# tests/test_scenario.py

import unittest
from cnc_pipeline.scenario import detect_scenario

class TestScenario(unittest.TestCase):
    def test_detect_scenario_most_common(self):
        self.assertEqual(detect_scenario({"FREZ", "CUT"}), "most_common")

    def test_detect_scenario_common(self):
        self.assertEqual(detect_scenario({"HOLES", "FREZ", "CUT"}), "common")

    def test_detect_scenario_rare(self):
        self.assertEqual(detect_scenario({"FREZ", "FREZ_135", "CUT"}), "rare")

    def test_detect_scenario_very_rare(self):
        self.assertEqual(detect_scenario({"HOLES", "FREZ", "FREZ_135", "CUT"}), "very_rare")

    def test_detect_scenario_cut_only(self):
        self.assertEqual(detect_scenario({"CUT"}), "cut_only")

    def test_detect_scenario_missing_cut(self):
        with self.assertRaisesRegex(ValueError, "DXF has no CUT layer — cannot generate toolpath"):
            detect_scenario({"FREZ"})

if __name__ == "__main__":
    unittest.main()
