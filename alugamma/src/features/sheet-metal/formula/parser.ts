/**
import { type ParsedToken, type ParseError, type ParsedHoleToken, tokenize, parseHoleToken, SIDE_SWITCH_MAP, DEFAULT_HOLE_SIDE_OFFSET, DEFAULT_HOLE_END_OFFSET, DEFAULT_HOLE_LENGTH, } from "./grammar";
 *
 * The formula is a space-separated token stream. The parser walks tokens
 * left-to-right using a simple state machine (activeSide, lastFeatureRef)
 * and builds up the model incrementally.
 *
 * On error the parser returns the last valid state plus error info so
 * incomplete formulas don't blank the canvas.
 */

import {
  type SheetMetalModel,
  type SideKey,
  type FlangeMeasurement,
  type FrezMeasurement,
  type HoleData,
  createEmptyModel,
  createFlangeMeasurement,
  createFrezMeasurement,
  createInnerFrezMeasurement,
  normalizeSheetMetalModel,
} from "@/features/sheet-metal/types";

import {
  type ParsedToken,
  type ParseError,
  type ParsedHoleToken,
  tokenize,
  parseHoleToken,
  SIDE_SWITCH_MAP,
  DEFAULT_BASE_WIDTH,
  DEFAULT_BASE_HEIGHT,
} from "./grammar";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParseResult = {
  /** The parsed model (always present — falls back to lastValidModel on error) */
  model: SheetMetalModel;
  /** Non-fatal errors encountered while parsing */
  errors: ParseError[];
  /** The filename prefix, e.g. "(myFile_x2)", or null */
  filename: string | null;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type LastFeature =
  | { kind: "flange"; side: SideKey; index: number }
  | { kind: "outerFrez"; side: SideKey; index: number }
  | { kind: "innerFrez"; side: SideKey; index: number }
  | null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a formula string into a SheetMetalModel.
 *
 * Graceful degradation: on first unparseable token the parser returns
 * the model built so far and a list of errors.
 */
export function parseFormula(formula: string): ParseResult {
  const { tokens, errors: tokenizeErrors } = tokenize(formula);

  if (tokens.length === 0) {
    return {
      model: createEmptyModel(),
      errors: tokenizeErrors,
      filename: null,
    };
  }

  // Build model incrementally
  let model = createEmptyModel();
  model.baseWidth = DEFAULT_BASE_WIDTH;
  model.baseHeight = DEFAULT_BASE_HEIGHT;
  let filename: string | null = null;

  let activeSide: SideKey = "top";
  let lastFeature: LastFeature = null;
  const parseErrors: ParseError[] = [...tokenizeErrors];

  for (const token of tokens) {
    switch (token.type) {
      case "BASE": {
        const match = token.raw.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
        if (match) {
          model.baseWidth = parseFloat(match[1]);
          model.baseHeight = parseFloat(match[2]);
        }
        break;
      }

      case "FILENAME": {
        const match = token.raw.match(/^\(([^)]+)\)$/);
        if (match) {
          filename = match[1];
        }
        break;
      }

      case "SIDE_SWITCH": {
        const side = SIDE_SWITCH_MAP[token.raw];
        if (side) {
          activeSide = side;
        }
        break;
      }

      case "FLANGE": {
        const match = token.raw.match(/^F(\d+(?:\.\d+)?)$/);
        if (match) {
          const amount = parseFloat(match[1]);
          const flange = createFlangeMeasurement(amount);
          addFlangeToSide(model, activeSide, flange);
          lastFeature = { kind: "flange", side: activeSide, index: model.sides[activeSide].flanges.length - 1 };
        }
        break;
      }

      case "OUTER_FREZ": {
        const match = token.raw.match(/^Z(\d+(?:\.\d+)?)$/);
        if (match) {
          const amount = parseFloat(match[1]);
          const frez = createFrezMeasurement(amount);
          addFrezToSide(model, activeSide, frez);
          lastFeature = { kind: "outerFrez", side: activeSide, index: model.sides[activeSide].frezLines.length - 1 };
        }
        break;
      }

      case "INNER_FREZ": {
        const match = token.raw.match(/^I(\d+(?:\.\d+)?)$/);
        if (match) {
          const amount = parseFloat(match[1]);
          const frez = createInnerFrezMeasurement(amount);
          addInnerFrezToSide(model, activeSide, frez);
          lastFeature = { kind: "innerFrez", side: activeSide, index: model.sides[activeSide].innerFrezLines.length - 1 };
        }
        break;
      }

      case "FREZ_MODE": {
        const match = token.raw.match(/^M(inner|outer)$/);
        if (match) {
          const mode = match[1] as "inner" | "outer";
          model.sides[activeSide].frezMode = mode;
        }
        break;
      }

      case "OFFSET": {
        const match = token.raw.match(/^O(\d+(?:\.\d+)?)$/);
        if (match) {
          model.offsetCut = parseFloat(match[1]);
        }
        break;
      }

      case "RELIEF_TOGGLE": {
        // Q = toggle start, E = toggle end on the last feature
        if (!lastFeature) {
          parseErrors.push({
            tokenIndex: token.index,
            token: token.raw,
            message: `"${token.raw}" toggles relief/notch but no feature exists on the current side yet`,
          });
          break;
        }

        const position = token.raw === "Q" ? "start" : "end";

        if (lastFeature.kind === "flange") {
          const flange = model.sides[lastFeature.side].flanges[lastFeature.index];
          if (flange) {
            flange.reliefs[position] = !flange.reliefs[position];
          }
        } else if (lastFeature.kind === "outerFrez") {
          const frez = model.sides[lastFeature.side].frezLines[lastFeature.index];
          if (frez) {
            frez.notches[position] = !frez.notches[position];
          }
        } else if (lastFeature.kind === "innerFrez") {
          const frez = model.sides[lastFeature.side].innerFrezLines[lastFeature.index];
          if (frez) {
            frez.notches[position] = !frez.notches[position];
          }
        }
        break;
      }

      case "FLAP": {
        const match = token.raw.match(/^V(\d+(?:\.\d+)?)$/);
        if (match) {
          const amount = parseFloat(match[1]);
          if (!lastFeature || lastFeature.kind !== "flange") {
            parseErrors.push({
              tokenIndex: token.index,
              token: token.raw,
              message: `"V${amount}" adds a flap but no flange exists on the current side yet`,
            });
            break;
          }
          const flange = model.sides[lastFeature.side].flanges[lastFeature.index];
          if (flange) {
            // Flap is applied to both start and end if they have reliefs
            // For simplicity: V sets both flaps to the same amount
            flange.flaps.start = amount;
            flange.flaps.end = amount;
          }
        }
        break;
      }

      case "SPAN_START": {
        if (!lastFeature || lastFeature.kind !== "innerFrez") {
          parseErrors.push({
            tokenIndex: token.index,
            token: token.raw,
            message: `"P" toggles spanStart but no inner FREZ exists on the current side yet`,
          });
          break;
        }
        const frez = model.sides[lastFeature.side].innerFrezLines[lastFeature.index];
        if (frez) {
          frez.spanStart = !frez.spanStart;
        }
        break;
      }

      case "SPAN_END": {
        if (!lastFeature || lastFeature.kind !== "innerFrez") {
          parseErrors.push({
            tokenIndex: token.index,
            token: token.raw,
            message: `"N" toggles spanEnd but no inner FREZ exists on the current side yet`,
          });
          break;
        }
        const frez = model.sides[lastFeature.side].innerFrezLines[lastFeature.index];
        if (frez) {
          frez.spanEnd = !frez.spanEnd;
        }
        break;
      }

      case "HOLES": {
        if (!lastFeature) {
          parseErrors.push({
            tokenIndex: token.index,
            token: token.raw,
            message: `"${token.raw}" attaches holes but no feature exists on the current side yet`,
          });
          break;
        }

        const parsed = parseHoleToken(token.raw);
        const holeData = holeTokenToHoleData(parsed);

        if (lastFeature.kind === "flange") {
          const flange = model.sides[lastFeature.side].flanges[lastFeature.index];
          if (flange) {
            flange.holes = holeData;
          }
        } else if (lastFeature.kind === "innerFrez") {
          const frez = model.sides[lastFeature.side].innerFrezLines[lastFeature.index];
          if (frez) {
            frez.holes = holeData;
          }
        } else if (lastFeature.kind === "outerFrez") {
          // outer frez can also have holes attached
          const frez = model.sides[lastFeature.side].frezLines[lastFeature.index];
          if (frez) {
            frez.holes = holeData;
          }
        }
        break;
      }

      case "UNKNOWN": {
        // Already captured by tokenize()
        break;
      }
    }
  }

  return {
    model: normalizeSheetMetalModel(model),
    errors: parseErrors,
    filename,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addFlangeToSide(model: SheetMetalModel, side: SideKey, flange: FlangeMeasurement): void {
  model.sides[side].flanges.push(flange);
}

function addFrezToSide(model: SheetMetalModel, side: SideKey, frez: FrezMeasurement): void {
  model.sides[side].frezLines.push(frez);
}

function addInnerFrezToSide(model: SheetMetalModel, side: SideKey, frez: FrezMeasurement): void {
  model.sides[side].innerFrezLines.push(frez);
}

function holeTokenToHoleData(parsed: ParsedHoleToken): HoleData {
  return {
    enabled: true,
    placement: parsed.placement,
    orientation: parsed.orientation,
    sideOffset: parsed.sideOffset,
    endOffset: parsed.endOffset,
    length: parsed.length,
    line1Enabled: parsed.line1Enabled,
    line2Enabled: parsed.line2Enabled,
  };
}