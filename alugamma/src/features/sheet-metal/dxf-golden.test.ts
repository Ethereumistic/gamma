// ────────────────────────────────────────────────────────────────────────────────
// Sheet-Metal — Golden DXF Regression Test
//
// Asserts that `buildDxf(geometry, exportName, model)` produces
// **byte-identical output** to the saved golden files for each
// production fixture, after every change in TASK 10.
//
// This is the production safety net. The golden files are committed
// alongside this test. The test reads models from
// `__fixtures__/production-designs.ts` (no Convex access needed).
//
// To regenerate golden files after an intentional change:
//   pnpm vitest run --update src/features/sheet-metal/dxf-golden.test.ts
//
// The implementer MUST review the git diff of the .dxf files before
// committing the update. Empty diff = safe.
// ────────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeSheetMetalGeometry } from "@/features/sheet-metal/geometry";
import { buildDxf } from "@/features/sheet-metal/dxf";
import { PRODUCTION_DESIGNS } from "./__fixtures__/production-designs";

const GOLDEN_DIR = resolve(__dirname, "./__fixtures__/dxf-golden");

describe("dxf-golden: byte-equality regression for production designs", () => {
  it.each(PRODUCTION_DESIGNS)(
    "$name ($id) — buildDxf output is byte-identical to golden file",
    (design) => {
      const goldenPath = resolve(GOLDEN_DIR, `${design.name}.dxf`);
      const golden = readFileSync(goldenPath, "utf8");

      const geometry = computeSheetMetalGeometry(design.model);
      const actual = buildDxf(geometry, design.exportName, design.model);

      expect(actual).toBe(golden);
    },
  );
});
