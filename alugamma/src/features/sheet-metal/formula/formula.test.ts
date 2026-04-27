/**
 * formula/formula.test.ts — Unit tests for the Formula DSL parser & serializer.
 *
 * Tests:
 * 1. Tokenizer: each token type recognized
 * 2. Parser: individual token parsing
 * 3. Serializer: model → formula
 * 4. Round-trip: parse(serialize(model)) ≈ model
 * 5. Partial/incomplete formulas & error handling
 */

import { describe, it, expect } from "vitest";
import { tokenize, parseHoleToken, TOKEN_PATTERNS } from "./grammar";
import { parseFormula } from "./parser";
import { serializeFormula } from "./serializer";
import {
  type SheetMetalModel,
  createEmptyModel,
  createFlangeMeasurement,
  createFrezMeasurement,
  createInnerFrezMeasurement,
} from "@/features/sheet-metal/types";

// ---------------------------------------------------------------------------
// 1. Tokenizer
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("recognizes BASE token", () => {
    const { tokens, errors } = tokenize("500x500");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("BASE");
    expect(errors).toHaveLength(0);
  });

  it("recognizes BASE with decimals", () => {
    const { tokens } = tokenize("500.5x300.25");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("BASE");
  });

  it("recognizes side switch tokens", () => {
    for (const raw of ["W", "A", "S", "D"]) {
      const { tokens, errors } = tokenize(raw);
      expect(tokens[0].type).toBe("SIDE_SWITCH");
      expect(errors).toHaveLength(0);
    }
  });

  it("recognizes FLANGE token", () => {
    const { tokens } = tokenize("F60");
    expect(tokens[0].type).toBe("FLANGE");
  });

  it("recognizes OUTER_FREZ token", () => {
    const { tokens } = tokenize("Z20");
    expect(tokens[0].type).toBe("OUTER_FREZ");
  });

  it("recognizes INNER_FREZ token", () => {
    const { tokens } = tokenize("I20");
    expect(tokens[0].type).toBe("INNER_FREZ");
  });

  it("recognizes FREZ_MODE token", () => {
    const { tokens } = tokenize("Minner Mouter");
    expect(tokens[0].type).toBe("FREZ_MODE");
    expect(tokens[1].type).toBe("FREZ_MODE");
  });

  it("recognizes OFFSET token", () => {
    const { tokens } = tokenize("O3");
    expect(tokens[0].type).toBe("OFFSET");
  });

  it("recognizes RELIEF_TOGGLE tokens", () => {
    const { tokens } = tokenize("Q E");
    expect(tokens[0].type).toBe("RELIEF_TOGGLE");
    expect(tokens[1].type).toBe("RELIEF_TOGGLE");
  });

  it("recognizes FLAP token", () => {
    const { tokens } = tokenize("V5");
    expect(tokens[0].type).toBe("FLAP");
  });

  it("recognizes SPAN tokens", () => {
    const { tokens } = tokenize("P N");
    expect(tokens[0].type).toBe("SPAN_START");
    expect(tokens[1].type).toBe("SPAN_END");
  });

  it("recognizes HOLES token", () => {
    const { tokens } = tokenize("HS28E28L19O");
    expect(tokens[0].type).toBe("HOLES");
  });

  it("recognizes HOLES token with L suffix", () => {
    const { tokens } = tokenize("HS28E28L19OL");
    expect(tokens[0].type).toBe("HOLES");
  });

  it("recognizes HOLES token with R suffix", () => {
    const { tokens } = tokenize("HS28E28L19OR");
    expect(tokens[0].type).toBe("HOLES");
  });



  it("recognizes FILENAME token", () => {
    const { tokens } = tokenize("(myfile_x2)");
    expect(tokens[0].type).toBe("FILENAME");
  });

  it("marks unknown tokens", () => {
    const { tokens, errors } = tokenize("XYZ");
    expect(tokens[0].type).toBe("UNKNOWN");
    expect(errors).toHaveLength(1);
  });

  it("handles empty formula", () => {
    const { tokens, errors } = tokenize("");
    expect(tokens).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("handles multiple tokens", () => {
    const { tokens } = tokenize("500x500 W F60 Q E");
    expect(tokens).toHaveLength(5);
    expect(tokens.map(t => t.type)).toEqual([
      "BASE", "SIDE_SWITCH", "FLANGE", "RELIEF_TOGGLE", "RELIEF_TOGGLE",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Hole token parser
// ---------------------------------------------------------------------------

describe("parseHoleToken", () => {
  it("parses full hole token", () => {
    const result = parseHoleToken("HS28E28L19O");
    expect(result.sideOffset).toBe(28);
    expect(result.endOffset).toBe(28);
    expect(result.length).toBe(19);
    expect(result.placement).toBe("outer");
    expect(result.orientation).toBe("horizontal");
    expect(result.line1Enabled).toBe(true);
    expect(result.line2Enabled).toBe(true);
  });

  it("parses hole token with inner placement", () => {
    const result = parseHoleToken("HS10E10L5I");
    expect(result.placement).toBe("inner");
  });

  it("parses hole token with vertical orientation", () => {
    const result = parseHoleToken("HS10E10L5OV");
    expect(result.placement).toBe("outer");
    expect(result.orientation).toBe("vertical");
  });

  it("parses hole token with L suffix (line1 only)", () => {
    const result = parseHoleToken("HS10E10L5OL");
    expect(result.line1Enabled).toBe(true);
    expect(result.line2Enabled).toBe(false);
  });

  it("parses hole token with R suffix (line2 only)", () => {
    const result = parseHoleToken("HS10E10L5OR");
    expect(result.line1Enabled).toBe(false);
    expect(result.line2Enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Parser
// ---------------------------------------------------------------------------

describe("parseFormula", () => {
  it("parses base dimensions", () => {
    const { model, errors } = parseFormula("500x500");
    expect(errors).toHaveLength(0);
    expect(model.baseWidth).toBe(500);
    expect(model.baseHeight).toBe(500);
  });

  it("parses a flange on the top side", () => {
    const { model, errors } = parseFormula("500x500 W F60");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.flanges).toHaveLength(1);
    expect(model.sides.top.flanges[0].amount).toBe(60);
  });

  it("parses relief toggles on a flange", () => {
    const { model, errors } = parseFormula("500x500 W F60 Q E");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.flanges[0].reliefs.start).toBe(true);
    expect(model.sides.top.flanges[0].reliefs.end).toBe(true);
  });

  it("parses Q as toggle (double Q = off again)", () => {
    const { model, errors } = parseFormula("500x500 W F60 Q Q");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.flanges[0].reliefs.start).toBe(false);
  });

  it("parses outer frez with notches", () => {
    const { model, errors } = parseFormula("500x500 W Z20 Q E");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.frezLines).toHaveLength(1);
    expect(model.sides.top.frezLines[0].amount).toBe(20);
    expect(model.sides.top.frezLines[0].notches.start).toBe(true);
    expect(model.sides.top.frezLines[0].notches.end).toBe(true);
  });

  it("parses inner frez with span", () => {
    const { model, errors } = parseFormula("500x500 W I20 P N");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.innerFrezLines).toHaveLength(1);
    expect(model.sides.top.innerFrezLines[0].spanStart).toBe(true);
    expect(model.sides.top.innerFrezLines[0].spanEnd).toBe(true);
  });

  it("parses frez mode", () => {
    const { model, errors } = parseFormula("500x500 W Mouter");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.frezMode).toBe("outer");
  });

  it("parses offset", () => {
    const { model, errors } = parseFormula("500x500 O5");
    expect(errors).toHaveLength(0);
    expect(model.offsetCut).toBe(5);
  });

  it("parses holes on a flange", () => {
    const { model, errors } = parseFormula("500x500 W F60 HS28E28L19O");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.flanges[0].holes?.enabled).toBe(true);
    expect(model.sides.top.flanges[0].holes?.sideOffset).toBe(28);
    expect(model.sides.top.flanges[0].holes?.endOffset).toBe(28);
    expect(model.sides.top.flanges[0].holes?.length).toBe(19);
  });

  it("parses flap on a flange", () => {
    const { model, errors } = parseFormula("500x500 W F60 V5");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.flanges[0].flaps.start).toBe(5);
    expect(model.sides.top.flanges[0].flaps.end).toBe(5);
  });

  it("parses multiple sides", () => {
    const { model, errors } = parseFormula("500x500 W F60 S F120");
    expect(errors).toHaveLength(0);
    expect(model.sides.top.flanges).toHaveLength(1);
    expect(model.sides.bottom.flanges).toHaveLength(1);
    expect(model.sides.bottom.flanges[0].amount).toBe(120);
  });

  it("parses filename prefix", () => {
    const { filename, errors } = parseFormula("(myfile_x2) 500x500");
    expect(errors).toHaveLength(0);
    expect(filename).toBe("myfile_x2");
  });

  it("returns error for Q without prior feature", () => {
    const { errors } = parseFormula("500x500 W Q");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("no feature exists");
  });

  it("returns error for P without inner frez", () => {
    const { errors } = parseFormula("500x500 W P");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("handles empty formula", () => {
    const { model } = parseFormula("");
    expect(model).toBeDefined();
    expect(model.baseWidth).toBe(900); // default
  });

  it("preserves last valid model on error", () => {
    const { model, errors } = parseFormula("500x500 W F60 BLAH");
    // Model should have the base and flange even though BLAH is invalid
    expect(model.baseWidth).toBe(500);
    expect(model.sides.top.flanges).toHaveLength(1);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Serializer
// ---------------------------------------------------------------------------

describe("serializeFormula", () => {
  it("serializes the default empty model", () => {
    const model = createEmptyModel();
    const formula = serializeFormula(model);
    expect(formula).toBe("900x520");
  });

  it("serializes a model with a flange", () => {
    const model = createEmptyModel();
    model.sides.top.flanges.push(createFlangeMeasurement(60));
    const formula = serializeFormula(model);
    expect(formula).toContain("W F60");
  });

  it("serializes relief toggles", () => {
    const model = createEmptyModel();
    const flange = createFlangeMeasurement(60, { start: true, end: true });
    model.sides.top.flanges.push(flange);
    const formula = serializeFormula(model);
    expect(formula).toBe("900x520 W F60 Q E");
  });

  it("serializes outer frez", () => {
    const model = createEmptyModel();
    model.sides.top.frezLines.push(createFrezMeasurement(20, { start: true, end: false }));
    const formula = serializeFormula(model);
    expect(formula).toBe("900x520 W Z20 Q");
  });

  it("serializes inner frez with span", () => {
    const model = createEmptyModel();
    const frez = createInnerFrezMeasurement(20);
    frez.spanStart = true;
    frez.spanEnd = true;
    model.sides.top.innerFrezLines.push(frez);
    const formula = serializeFormula(model);
    expect(formula).toBe("900x520 W I20 P N");
  });

  it("serializes frez mode", () => {
    const model = createEmptyModel();
    model.sides.top.frezMode = "outer";
    const formula = serializeFormula(model);
    expect(formula).toContain("Mouter");
  });

  it("serializes non-default offset", () => {
    const model = createEmptyModel();
    model.offsetCut = 5;
    const formula = serializeFormula(model);
    expect(formula).toContain("O5");
  });

  it("does not serialize default offset", () => {
    const model = createEmptyModel();
    model.offsetCut = 3; // default
    const formula = serializeFormula(model);
    expect(formula).not.toContain("O3");
  });

  it("serializes holes on a flange", () => {
    const model = createEmptyModel();
    const flange = createFlangeMeasurement(60);
    flange.holes = {
      enabled: true,
      placement: "outer",
      orientation: "horizontal",
      sideOffset: 28,
      endOffset: 28,
      length: 19,
      line1Enabled: true,
      line2Enabled: true,
    };
    model.sides.top.flanges.push(flange);
    const formula = serializeFormula(model);
    expect(formula).toContain("HS28E28L19O");
  });

  it("serializes multiple sides", () => {
    const model = createEmptyModel();
    model.sides.top.flanges.push(createFlangeMeasurement(60));
    model.sides.bottom.flanges.push(createFlangeMeasurement(120));
    const formula = serializeFormula(model);
    expect(formula).toContain("W F60");
    expect(formula).toContain("S F120");
  });

  it("serializes filename prefix", () => {
    const model = createEmptyModel();
    const formula = serializeFormula(model, "myfile_x2");
    expect(formula).toContain("(myfile_x2)");
  });
});

// ---------------------------------------------------------------------------
// 5. Round-trip: parse(serialize(model)) ≈ model
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  function roundTrip(original: SheetMetalModel) {
    const formula = serializeFormula(original);
    const { model: parsed, errors } = parseFormula(formula);
    expect(errors).toHaveLength(0);
    return parsed;
  }

  /** Compare geometry-relevant fields (ignoring IDs which are generated) */
  function expectModelEqual(a: SheetMetalModel, b: SheetMetalModel) {
    expect(a.baseWidth).toBe(b.baseWidth);
    expect(a.baseHeight).toBe(b.baseHeight);
    expect(a.offsetCut).toBe(b.offsetCut);
    for (const side of ["top", "right", "bottom", "left"] as const) {
      expect(a.sides[side].flanges.length).toBe(b.sides[side].flanges.length);
      a.sides[side].flanges.forEach((f, i) => {
        expect(f.amount).toBe(b.sides[side].flanges[i].amount);
        expect(f.reliefs.start).toBe(b.sides[side].flanges[i].reliefs.start);
        expect(f.reliefs.end).toBe(b.sides[side].flanges[i].reliefs.end);
        expect(f.flaps.start).toBe(b.sides[side].flanges[i].flaps.start);
        expect(f.flaps.end).toBe(b.sides[side].flanges[i].flaps.end);
      });
      expect(a.sides[side].frezLines.length).toBe(b.sides[side].frezLines.length);
      a.sides[side].frezLines.forEach((f, i) => {
        expect(f.amount).toBe(b.sides[side].frezLines[i].amount);
        expect(f.notches.start).toBe(b.sides[side].frezLines[i].notches.start);
        expect(f.notches.end).toBe(b.sides[side].frezLines[i].notches.end);
      });
      expect(a.sides[side].innerFrezLines.length).toBe(b.sides[side].innerFrezLines.length);
      a.sides[side].innerFrezLines.forEach((f, i) => {
        expect(f.amount).toBe(b.sides[side].innerFrezLines[i].amount);
        expect(f.notches.start).toBe(b.sides[side].innerFrezLines[i].notches.start);
        expect(f.notches.end).toBe(b.sides[side].innerFrezLines[i].notches.end);
        expect(f.spanStart).toBe(b.sides[side].innerFrezLines[i].spanStart);
        expect(f.spanEnd).toBe(b.sides[side].innerFrezLines[i].spanEnd);
      });
      expect(a.sides[side].frezMode).toBe(b.sides[side].frezMode);
    }
  }

  it("round-trips the empty model", () => {
    const model = createEmptyModel();
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
  });

  it("round-trips a model with a top flange + reliefs", () => {
    const model = createEmptyModel();
    model.baseWidth = 500;
    model.baseHeight = 500;
    model.sides.top.flanges.push(createFlangeMeasurement(60, { start: true, end: true }));
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
  });

  it("round-trips a model with outer frez + notches", () => {
    const model = createEmptyModel();
    model.sides.top.frezLines.push(createFrezMeasurement(20, { start: true, end: true }));
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
  });

  it("round-trips a model with inner frez + span", () => {
    const model = createEmptyModel();
    const frez = createInnerFrezMeasurement(20);
    frez.spanStart = true;
    frez.spanEnd = false;
    model.sides.left.innerFrezLines.push(frez);
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
  });

  it("round-trips a complex model (golden 1)", () => {
    const model = createEmptyModel();
    model.baseWidth = 500;
    model.baseHeight = 500;
    model.sides.top.flanges.push(createFlangeMeasurement(60));
    model.sides.bottom.flanges.push(createFlangeMeasurement(120));
    model.sides.left.frezLines.push(createFrezMeasurement(20));
    model.sides.right.frezMode = "outer";
    model.offsetCut = 5;
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
  });

  it("round-trips a model with holes", () => {
    const model = createEmptyModel();
    const flange = createFlangeMeasurement(60);
    flange.holes = {
      enabled: true,
      placement: "outer",
      orientation: "horizontal",
      sideOffset: 28,
      endOffset: 28,
      length: 19,
      line1Enabled: true,
      line2Enabled: true,
    };
    model.sides.top.flanges.push(flange);
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
    // Check holes specifically
    expect(rt.sides.top.flanges[0].holes?.enabled).toBe(true);
    expect(rt.sides.top.flanges[0].holes?.sideOffset).toBe(28);
    expect(rt.sides.top.flanges[0].holes?.endOffset).toBe(28);
    expect(rt.sides.top.flanges[0].holes?.length).toBe(19);
    expect(rt.sides.top.flanges[0].holes?.placement).toBe("outer");
  });

  it("round-trips golden: flanges on all 4 sides with reliefs", () => {
    const model = createEmptyModel();
    model.baseWidth = 500;
    model.baseHeight = 500;
    model.sides.top.flanges.push(createFlangeMeasurement(60, { start: true, end: true }));
    model.sides.right.flanges.push(createFlangeMeasurement(40, { start: true }));
    model.sides.bottom.flanges.push(createFlangeMeasurement(50));
    model.sides.left.flanges.push(createFlangeMeasurement(30, { end: true }));
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
  });

  it("round-trips golden: outer frez lines with notches", () => {
    const model = createEmptyModel();
    model.baseWidth = 500;
    model.baseHeight = 500;
    model.sides.top.flanges.push(createFlangeMeasurement(60));
    model.sides.top.frezLines.push(createFrezMeasurement(20, { start: true, end: true }));
    model.sides.right.flanges.push(createFlangeMeasurement(40));
    model.sides.bottom.flanges.push(createFlangeMeasurement(50));
    model.sides.bottom.frezLines.push(createFrezMeasurement(15, { start: true, end: true }));
    model.sides.left.flanges.push(createFlangeMeasurement(30));
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
  });

  it("round-trips golden: complex model (prototype relief)", () => {
    const model = createEmptyModel();
    model.baseWidth = 1040;
    model.baseHeight = 610;
    model.sides.top.flanges.push(createFlangeMeasurement(26));
    model.sides.right.flanges.push(createFlangeMeasurement(28));
    model.sides.bottom.flanges.push(createFlangeMeasurement(142));
    model.sides.bottom.frezLines.push(createFrezMeasurement(116, { start: true, end: true }));
    model.sides.left.flanges.push(createFlangeMeasurement(30));
    model.sides.left.frezLines.push(createFrezMeasurement(220, { start: true, end: true }));
    model.offsetCut = 3;
    const rt = roundTrip(model);
    expectModelEqual(model, rt);
  });
});