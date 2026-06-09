// PROBE: write a sample mixed-parts nested sheet DXF for manual inspection.
import { describe, it } from "vitest";
import { createNestPartFromDesign } from "@/features/nesting/dxf-reader";
import { writeNestSheetDxf } from "@/features/nesting/dxf-writer";
import { packAllParts } from "@/features/nesting/packer";
import { PRODUCTION_DESIGNS } from "../sheet-metal/__fixtures__/production-designs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../sheet-metal/__fixtures__/user-check");
mkdirSync(OUT_DIR, { recursive: true });

describe("PROBE: sample DXF for user inspection", () => {
  it("writes a 5-part nested sheet DXF to disk", () => {
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

    // Count CUT-layer entities
    const lines = dxf.split(/\r?\n/);
    let lwpolylineCount = 0;
    let lineCount = 0;
    let inEntity = false;
    let entityType = "";
    let layer = "";
    for (let i = 0; i < lines.length - 1; i++) {
      const code = lines[i].trim();
      const val = lines[i + 1].trim();
      if (code === "0") {
        if (entityType === "LWPOLYLINE" && layer === "CUT") lwpolylineCount++;
        if (entityType === "LINE" && layer === "CUT") lineCount++;
        entityType = val;
        layer = "";
      } else if (code === "8") {
        layer = val;
      }
    }
    if (entityType === "LWPOLYLINE" && layer === "CUT") lwpolylineCount++;
    if (entityType === "LINE" && layer === "CUT") lineCount++;

    // eslint-disable-next-line no-console
    console.log(`5-part sheet: ${lwpolylineCount} LWPOLYLINE + ${lineCount} LINE entities on CUT layer`);
    // eslint-disable-next-line no-console
    console.log(`DXF size: ${dxf.length} bytes`);

    const outPath = resolve(OUT_DIR, "5-part-sheet.dxf");
    writeFileSync(outPath, dxf, "utf8");
    // eslint-disable-next-line no-console
    console.log(`Wrote ${outPath}`);
    // eslint-disable-next-line no-console
    console.log("Open this file in a CAD viewer (e.g., LibreCAD, viewer.autodesk.com)");
    // eslint-disable-next-line no-console
    console.log("Expected: each of the 5 parts appears as a single closed LWPOLYLINE on the CUT layer (green).");
  });
});
