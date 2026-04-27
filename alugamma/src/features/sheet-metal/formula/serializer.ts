/**
 * formula/serializer.ts — Convert a SheetMetalModel back into a formula string.
 *
 * Serialization rules:
 * 1. Start with `<width>x<height>`
 * 2. Optional filename prefix: `(<filename>)` 
 * 3. For each side (W=top, A=left, S=bottom, D=right):
 *    - Emit side switch if side has features
 *    - Emit flanges, then outer frez, then inner frez
 *    - Emit Q/E after each feature that has them
 *    - Emit V<amount> after each flange that has flaps
 *    - Emit P/N after each inner frez that has span
 *    - Emit H... after each feature that has holes
 * 4. Emit frez mode if non-default
 * 5. Emit offset if non-default
 */

import {
  type SheetMetalModel,
  type SideKey,
  type FlangeMeasurement,
  type FrezMeasurement,
  type HoleData,
} from "@/features/sheet-metal/types";
import { DEFAULT_OFFSET_CUT } from "./grammar";

// ---------------------------------------------------------------------------
// Side ordering: top, left, bottom, right → W, A, S, D
// ---------------------------------------------------------------------------

const SIDE_ORDER: Array<{ key: SideKey; token: string }> = [
  { key: "top", token: "W" },
  { key: "left", token: "A" },
  { key: "bottom", token: "S" },
  { key: "right", token: "D" },
];



// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a SheetMetalModel into a canonical formula string.
 * 
 * @param model The sheet metal model
 * @param filename Optional filename prefix (stripped of parens if already present)
 * @returns A formula string like `500x500 WF60 Q E AF120`
 */
export function serializeFormula(model: SheetMetalModel, filename?: string | null): string {
  const tokens: string[] = [];

  // Filename prefix
  if (filename) {
    const clean = filename.replace(/^\(|\)$/g, "");
    tokens.push(`(${clean})`);
  }

  // Base dimensions
  tokens.push(`${model.baseWidth}x${model.baseHeight}`);

  // Per-side features
  for (const { key, token: sideToken } of SIDE_ORDER) {
    const side = model.sides[key];
    const hasFeatures =
      side.flanges.length > 0 ||
      side.frezLines.length > 0 ||
      side.innerFrezLines.length > 0 ||
      side.frezMode !== "inner";

    if (!hasFeatures) continue;

    tokens.push(sideToken);

    // Flanges
    for (const flange of side.flanges) {
      tokens.push(`F${flange.amount}`);
      if (flange.reliefs.start) tokens.push("Q");
      if (flange.reliefs.end) tokens.push("E");
      if (flange.flaps.start > 0 && flange.flaps.start === flange.flaps.end) {
        tokens.push(`V${flange.flaps.start}`);
      } else {
        if (flange.flaps.start > 0) tokens.push(`V${flange.flaps.start}`);
        // Note: flaps.start === flaps.end is the common case, handled above
      }
      if (flange.holes?.enabled) {
        tokens.push(serializeHoleToken(flange.holes));
      }
    }

    // Outer FREZ lines
    for (const frez of side.frezLines) {
      tokens.push(`Z${frez.amount}`);
      if (frez.notches.start) tokens.push("Q");
      if (frez.notches.end) tokens.push("E");
      if (frez.holes?.enabled) {
        tokens.push(serializeHoleToken(frez.holes));
      }
    }

    // Inner FREZ lines
    for (const frez of side.innerFrezLines) {
      tokens.push(`I${frez.amount}`);
      if (frez.notches.start) tokens.push("Q");
      if (frez.notches.end) tokens.push("E");
      if (frez.spanStart) tokens.push("P");
      if (frez.spanEnd) tokens.push("N");
      if (frez.holes?.enabled) {
        tokens.push(serializeHoleToken(frez.holes));
      }
    }

    // FREZ mode (only emit if non-default)
    if (side.frezMode === "outer") {
      tokens.push("Mouter");
    }
  }

  // Offset (only emit if non-default)
  if (model.offsetCut !== DEFAULT_OFFSET_CUT) {
    tokens.push(`O${model.offsetCut}`);
  }

  return tokens.join(" ");
}

// ---------------------------------------------------------------------------
// Hole token serialization
// ---------------------------------------------------------------------------

function serializeHoleToken(hole: HoleData): string {
  let token = "H";
  token += `S${hole.sideOffset}`;
  token += `E${hole.endOffset}`;
  token += `L${hole.length}`;

  if (hole.placement === "inner") {
    token += "I";
  } else {
    token += "O";
  }

  if (hole.orientation === "vertical") {
    token += "V";
  }
  // Horizontal is default, no letter needed (but H is used for the start of the token)

  // Line enable suffix
  const line1 = hole.line1Enabled !== false;
  const line2 = hole.line2Enabled !== false;
  if (line1 && !line2) {
    token += "L";
  } else if (!line1 && line2) {
    token += "R";
  }
  // Both enabled = no suffix (default)

  return token;
}