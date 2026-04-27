import { describe, it, expect } from "vitest";
import { computeSheetMetalGeometry } from "./geometry";
import {
  createEmptyModel,
  createFlangeMeasurement,
  createFrezMeasurement,
  type SheetMetalModel,
} from "./types";
import { parseFormula } from "./formula/parser";
import { serializeFormula } from "./formula/serializer";

/** Build a complex model with all 4 sides having flanges, frez, and holes */
function buildComplexModel(): SheetMetalModel {
  const base = createEmptyModel();
  return {
    ...base,
    baseWidth: 600,
    baseHeight: 400,
    offsetCut: 3,
    sides: {
      top: {
        flanges: [
          createFlangeMeasurement(60, { start: true, end: true }, { start: 5, end: 5 }),
        ],
        frezLines: [createFrezMeasurement(40, { start: false, end: false })],
        frezMode: "inner",
        innerFrezLines: [],
      },
      bottom: {
        flanges: [
          createFlangeMeasurement(80, { start: true, end: false }),
        ],
        frezLines: [],
        frezMode: "inner",
        innerFrezLines: [],
      },
      left: {
        flanges: [
          createFlangeMeasurement(50, { start: true, end: true }, { start: 8, end: 8 }),
        ],
        frezLines: [],
        frezMode: "inner",
        innerFrezLines: [],
      },
      right: {
        flanges: [],
        frezLines: [],
        frezMode: "inner",
        innerFrezLines: [createFrezMeasurement(35)],
      },
    },
  };
}

describe("Performance", () => {
  it("computeSheetMetalGeometry: 1000 iterations < 2s", () => {
    const complexModel = buildComplexModel();
    const start = performance.now();
    let result: ReturnType<typeof computeSheetMetalGeometry> | undefined;
    for (let i = 0; i < 1000; i++) {
      result = computeSheetMetalGeometry(complexModel);
    }
    const elapsed = performance.now() - start;
    console.log(`Geometry: 1000 calls in ${elapsed.toFixed(2)}ms, avg ${(elapsed/1000).toFixed(4)}ms`);
    expect(elapsed).toBeLessThan(2000);
    expect(result!.shapes.length).toBeGreaterThan(0);
  });

  it("formula parse+serialize: 1000 iterations < 500ms", () => {
    const formula = "600x400 W F60 Q E Z40 S F80 Q D I35 E A F50 Q E V8";
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const result = parseFormula(formula);
      serializeFormula(result.model);
    }
    const elapsed = performance.now() - start;
    console.log(`Formula: 1000 round-trips in ${elapsed.toFixed(2)}ms, avg ${(elapsed/1000).toFixed(4)}ms`);
    expect(elapsed).toBeLessThan(500);
  });

  it("long formula (50+ tokens): parse in < 5ms", () => {
    const tokens = ["500x500"];
    const sides = ["W", "S", "D", "A"];
    for (let s = 0; s < 4; s++) {
      tokens.push(sides[s]);
      for (let i = 0; i < 8; i++) {
        tokens.push(`F${20 + i * 10}`);
        if (i % 2 === 0) tokens.push("Q");
        if (i % 3 === 0) tokens.push("E");
      }
    }
    const longFormula = tokens.join(" ");
    console.log(`Long formula has ${tokens.length} tokens: ${longFormula}`);
    const start = performance.now();
    const model = parseFormula(longFormula);
    const elapsed = performance.now() - start;
    console.log(`Parsed ${tokens.length} tokens in ${elapsed.toFixed(4)}ms`);
    expect(elapsed).toBeLessThan(5);
    expect(model).toBeDefined();
  });
});