/**
 * formula/grammar.ts — Single source of truth for the Sheet-Metal Formula DSL tokens.
 *
 * The formula is a space-separated sequence of tokens:
 *   `500x500 WF60 Q20 AF120 SF120 Q20H DF20E20`
 *
 * Parsing rules:
 * - Tokens are strictly space-separated
 * - Each token matches exactly one regex below
 * - Q/E are toggle actions on the last feature on the current side
 * - H... is a single contiguous token (no spaces inside)
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

/** Default base width when no BASE token is present (mm). */
export const DEFAULT_BASE_WIDTH = 900;

/** Default base height when no BASE token is present (mm). */
export const DEFAULT_BASE_HEIGHT = 520;

/** Default offset-cut when no OFFSET token is present (mm). */
export const DEFAULT_OFFSET_CUT = 3;

/** Default hole sideOffset when not specified in H... token (mm). */
export const DEFAULT_HOLE_SIDE_OFFSET = 25;

/** Default hole endOffset when not specified in H... token (mm). */
export const DEFAULT_HOLE_END_OFFSET = 25;

/** Default hole length when not specified in H... token (mm). */
export const DEFAULT_HOLE_LENGTH = 25;

export type TokenType =
  | "BASE"          // `500x500`
  | "SIDE_SWITCH"   // `W` `A` `S` `D`
  | "FLANGE"        // `F60`
  | "OUTER_FREZ"    // `Z20`
  | "INNER_FREZ"    // `I20`
  | "FREZ_MODE"     // `Minner` / `Mouter`
  | "OFFSET"        // `O3`
  | "RELIEF_TOGGLE" // `Q` or `E`
  | "HOLES"         // `HS28E28L19O` / `HS28E28L19OR`
  | "FLAP"          // `V5`
  | "SPAN_START"    // `P` (toggle spanStart on last inner-frez)
  | "SPAN_END"      // `N` (toggle spanEnd on last inner-frez)
  | "FILENAME"      // `(myFile_x2)`
  | "UNKNOWN";

export type ParsedToken = {
  type: TokenType;
  raw: string;
  index: number; // 0-based token index in the formula
};

export type ParseError = {
  tokenIndex: number;
  token: string;
  message: string;
};

// ---------------------------------------------------------------------------
// Token regex patterns
// ---------------------------------------------------------------------------

export const TOKEN_PATTERNS: Record<Exclude<TokenType, "UNKNOWN">, RegExp> = {
  BASE: /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/,
  SIDE_SWITCH: /^[WASD]$/,
  FLANGE: /^F(\d+(?:\.\d+)?)$/,
  OUTER_FREZ: /^Z(\d+(?:\.\d+)?)$/,
  INNER_FREZ: /^I(\d+(?:\.\d+)?)$/,
  FREZ_MODE: /^M(inner|outer)$/,
  OFFSET: /^O(\d+(?:\.\d+)?)$/,
  RELIEF_TOGGLE: /^[QE]$/,
  HOLES: /^H(?:S\d+(?:\.\d+)?E\d+(?:\.\d+)?L\d+(?:\.\d+)?(?:[IO])?(?:[HV])?[LR]?)$/,
  FLAP: /^V(\d+(?:\.\d+)?)$/,
  SPAN_START: /^P$/,
  SPAN_END: /^N$/,
  FILENAME: /^\(([^)]+)\)$/,
};

/**
 * Ordered token matching list. More specific patterns are tested first
 * to avoid ambiguity. The tokenizer walks this array in order.
 */
const TOKEN_MATCH_ORDER: Array<Exclude<TokenType, "UNKNOWN">> = [
  "FILENAME",
  "BASE",
  "FREZ_MODE",
  "SIDE_SWITCH",
  "FLANGE",
  "OUTER_FREZ",
  "INNER_FREZ",
  "OFFSET",
  "RELIEF_TOGGLE",
  "HOLES",
  "FLAP",
  "SPAN_START",
  "SPAN_END",
];

// ---------------------------------------------------------------------------
// Side mapping
// ---------------------------------------------------------------------------

export const SIDE_SWITCH_MAP: Record<string, "top" | "left" | "bottom" | "right"> = {
  W: "top",
  A: "left",
  S: "bottom",
  D: "right",
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Split a formula string into raw tokens and categorize each one.
 * Returns an array of ParsedToken with type info + any parse errors.
 */
export function tokenize(formula: string): { tokens: ParsedToken[]; errors: ParseError[] } {
  const raw = formula.trim();
  if (!raw) return { tokens: [], errors: [] };

  const parts = raw.split(/\s+/).filter(Boolean);
  const tokens: ParsedToken[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < parts.length; i++) {
    const rawToken = parts[i];
    let matched = false;

    for (const type of TOKEN_MATCH_ORDER) {
      const pattern = TOKEN_PATTERNS[type];
      if (pattern.test(rawToken)) {
        tokens.push({ type: type as TokenType, raw: rawToken, index: i });
        matched = true;
        break;
      }
    }

    if (!matched) {
      tokens.push({ type: "UNKNOWN", raw: rawToken, index: i });
      errors.push({
        tokenIndex: i,
        token: rawToken,
        message: `Unrecognized token "${rawToken}"`,
      });
    }
  }

  return { tokens, errors };
}

// ---------------------------------------------------------------------------
// Hole token parser
// ---------------------------------------------------------------------------

export type ParsedHoleToken = {
  sideOffset: number;
  endOffset: number;
  length: number;
  placement: "inner" | "outer";
  orientation: "horizontal" | "vertical";
  line1Enabled: boolean;
  line2Enabled: boolean;
};

/**
 * Parse an H... token into its HoleData fields.
 * Format: HS<sideOffset>E<endOffset>L<length>[I|O][H|V][L|R]
 *
 * If trailing L/R absent, both lines are enabled.
 * Default placement: outer, default orientation: horizontal.
 */
export function parseHoleToken(raw: string): ParsedHoleToken {
  let rest = raw.slice(1); // strip leading H

  const sideOffsetMatch = rest.match(/^S(\d+(?:\.\d+)?)/);
  const sideOffset = sideOffsetMatch ? parseFloat(sideOffsetMatch[1]) : DEFAULT_HOLE_SIDE_OFFSET;
  if (sideOffsetMatch) rest = rest.slice(sideOffsetMatch[0].length);

  const endOffsetMatch = rest.match(/^E(\d+(?:\.\d+)?)/);
  const endOffset = endOffsetMatch ? parseFloat(endOffsetMatch[1]) : DEFAULT_HOLE_END_OFFSET;
  if (endOffsetMatch) rest = rest.slice(endOffsetMatch[0].length);

  const lengthMatch = rest.match(/^L(\d+(?:\.\d+)?)/);
  const length = lengthMatch ? parseFloat(lengthMatch[1]) : DEFAULT_HOLE_LENGTH;
  if (lengthMatch) rest = rest.slice(lengthMatch[0].length);

  let placement: "inner" | "outer" = "outer";
  if (rest.startsWith("I")) {
    placement = "inner";
    rest = rest.slice(1);
  } else if (rest.startsWith("O")) {
    placement = "outer";
    rest = rest.slice(1);
  }

  let orientation: "horizontal" | "vertical" = "horizontal";
  if (rest.startsWith("V")) {
    orientation = "vertical";
    rest = rest.slice(1);
  } else if (rest.startsWith("H")) {
    orientation = "horizontal";
    rest = rest.slice(1);
  }

  let line1Enabled = true;
  let line2Enabled = true;
  if (rest === "L") {
    line2Enabled = false;
  } else if (rest === "R") {
    line1Enabled = false;
  }

  return { sideOffset, endOffset, length, placement, orientation, line1Enabled, line2Enabled };
}