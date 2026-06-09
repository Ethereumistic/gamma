// ────────────────────────────────────────────────────────────────────────────────
// DXF validation: parse the output DXF as a sanity check that the LWPOLYLINE
// entities have the correct structure (subclass markers, group codes) and that
// the LAYER table includes all known layers.
//
// This catches problems like:
//   - Missing "100 AcDbEntity" / "100 AcDbPolyline" subclass markers
//   - Wrong group code order
//   - Missing LAYER entries for layers that have entities but no Maker.js models
// ────────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createNestPartFromDesign } from "@/features/nesting/dxf-reader";
import { writeNestSheetDxf } from "@/features/nesting/dxf-writer";
import { packAllParts } from "@/features/nesting/packer";
import { PRODUCTION_DESIGNS } from "../sheet-metal/__fixtures__/production-designs";
import type { NestPart, SheetLayout, Placement } from "@/features/nesting/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Entity = { type: string; layer: string; codes: Map<number, string> };
type LayerEntry = { name: string; color: number };

function parseDxf(dxf: string): { layers: LayerEntry[]; entities: Entity[] } {
  const lines = dxf.split(/\r?\n/);
  const layers: LayerEntry[] = [];
  const entities: Entity[] = [];
  let i = 0;

  while (i < lines.length - 1) {
    const code = parseInt(lines[i].trim(), 10);
    const val = lines[i + 1].trim();
    i += 2;

    if (isNaN(code)) continue;
    if (code !== 0) continue;

    if (val === "LAYER") {
      // LAYER entity: read until next group code 0
      const codes = new Map<number, string>();
      while (i < lines.length - 1) {
        const c = parseInt(lines[i].trim(), 10);
        const v = lines[i + 1].trim();
        if (c === 0) break;
        codes.set(c, v);
        i += 2;
      }
      const name = codes.get(2) ?? "";
      const color = parseInt(codes.get(62) ?? "0", 10);
      layers.push({ name, color });
    } else if (val === "LWPOLYLINE" || val === "LINE" || val === "TEXT") {
      const codes = new Map<number, string[]>();
      while (i < lines.length - 1) {
        const c = parseInt(lines[i].trim(), 10);
        const v = lines[i + 1].trim();
        if (c === 0) break;
        // Handle duplicate group codes (like multiple 100s) by storing arrays
        const existing = codes.get(c) ?? [];
        existing.push(v);
        codes.set(c, existing);
        i += 2;
      }
      // For single-value codes, unwrap the array for convenience
      const flatCodes = new Map<number, string>();
      const multiValueCodes = new Map<number, string[]>();
      for (const [k, v] of codes) {
        if (v.length === 1) flatCodes.set(k, v[0]);
        else multiValueCodes.set(k, v);
      }
      entities.push({ type: val, layer: flatCodes.get(8) ?? "0", codes: flatCodes });
      // Attach multi-value codes for subclass markers
      (entities[entities.length - 1] as any).multiCodes = multiValueCodes;
    }
  }
  return { layers, entities };
}

describe("DXF validation: LWPOLYLINE structure and LAYER table completeness", () => {
  it("5-part nested sheet: LAYER table includes CUT (green), LWPOLYLINE has AcDb subclass markers", () => {
    const partA = createNestPartFromDesign({
      id: "jx743me73n9e80t30am5gdnq19853wa4" as any,
      name: "gabrovo",
      exportName: "gabrovo_T_x20",
      model: PRODUCTION_DESIGNS[1].model,
    } as any);
    const partB = createNestPartFromDesign({
      id: "jx78pewhfhd2xf5t7mjc3hq73d84cdjt" as any,
      name: "flappy-flaps",
      exportName: "flappy-flaps_T_x8",
      model: PRODUCTION_DESIGNS[0].model,
    } as any);

    const job = {
      parts: [
        { ...partA, count: 3 },
        { ...partB, count: 2 },
      ],
      mode: "A" as const,
    };
    const result = packAllParts(job.parts, job.mode);
    const dxf = writeNestSheetDxf(result.layouts[0], job.parts);
    const { layers, entities } = parseDxf(dxf);

    // 1. LAYER table must include all known layers (CUT, FREZ, HOLES, etc.)
    const layerNames = new Set(layers.map((l) => l.name));
    expect(layerNames.has("CUT")).toBe(true);
    expect(layerNames.has("FREZ")).toBe(true);
    expect(layerNames.has("HOLES")).toBe(true);
    expect(layerNames.has("SHEETS")).toBe(true);

    // 2. CUT layer must have color 3 (green)
    const cutLayer = layers.find((l) => l.name === "CUT")!;
    expect(cutLayer.color).toBe(3);

    // 3. Every LWPOLYLINE must have:
    //    - group code 5 (handle) — optional but recommended
    //    - group code 8 (layer) = "CUT"
    //    - group code 100 (AcDbEntity subclass marker)
    //    - group code 100 (AcDbPolyline subclass marker)
    //    - group code 90 (vertex count)
    //    - group code 70 (flags)
    const lwpolylines = entities.filter((e) => e.type === "LWPOLYLINE");
    expect(lwpolylines.length).toBe(5);

    for (const lw of lwpolylines) {
      expect(lw.layer).toBe("CUT");
      expect(lw.codes.has(5)).toBe(true); // handle
      // Subclass markers (group code 100 can appear multiple times)
      const multiCodes = (lw as any).multiCodes as Map<number, string[]>;
      const hundredCodes = multiCodes.get(100) ?? [];
      expect(hundredCodes).toContain("AcDbEntity");
      expect(hundredCodes).toContain("AcDbPolyline");
      // Vertex count matches number of (10, 20) pairs
      const vertexCount = parseInt(lw.codes.get(90) ?? "0", 10);
      const xCoords = (multiCodes.get(10) ?? []).length;
      const yCoords = (multiCodes.get(20) ?? []).length;
      expect(xCoords).toBe(vertexCount);
      expect(yCoords).toBe(vertexCount);
    }

    // 4. Handles must be unique across all LWPOLYLINE entities
    const handles = lwpolylines.map((lw) => lw.codes.get(5)!);
    expect(new Set(handles).size).toBe(handles.length);
  });

  it("sheet-metal golden DXF: should also have valid LWPOLYLINE-free structure", () => {
    // The sheet-metal golden DXF is the baseline; this ensures the post-process
    // didn't break it.
    const goldenPath = resolve(__dirname, "../sheet-metal/__fixtures__/dxf-golden/gabrovo.dxf");
    const dxf = readFileSync(goldenPath, "utf8");
    const { layers, entities } = parseDxf(dxf);

    const cutLayer = layers.find((l) => l.name === "CUT");
    expect(cutLayer).toBeDefined();
    expect(cutLayer!.color).toBe(3);

    // The sheet-metal golden DXF has LINE entities, not LWPOLYLINE
    const lwpolylines = entities.filter((e) => e.type === "LWPOLYLINE");
    expect(lwpolylines.length).toBe(0);
  });
});
