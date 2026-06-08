// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Line Joiner Tests
// ────────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  joinSegments,
  joinSegmentsForLayer,
  joinStrategyForLayer,
  type JoinStrategy,
} from "./line-joiner";
import type { Segment } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check that two arrays of segments are approximately equal (within tolerance). */
function expectSegmentsEqual(
  actual: Segment[],
  expected: Segment[],
  tol: number = 0.01,
) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i].x1).toBeCloseTo(expected[i].x1, 2);
    expect(actual[i].y1).toBeCloseTo(expected[i].y1, 2);
    expect(actual[i].x2).toBeCloseTo(expected[i].x2, 2);
    expect(actual[i].y2).toBeCloseTo(expected[i].y2, 2);
  }
}

// ── Join Strategy per Layer ──────────────────────────────────────────────────

describe("joinStrategyForLayer", () => {
  it("returns 'skip' for SHEETS", () => {
    expect(joinStrategyForLayer("SHEETS")).toBe("skip");
  });

  it("returns 'skip' for '0'", () => {
    expect(joinStrategyForLayer("0")).toBe("skip");
  });

  it("returns 'orientation' for FREZ", () => {
    expect(joinStrategyForLayer("FREZ")).toBe("orientation");
  });

  it("returns 'orientation' for FREZ_135", () => {
    expect(joinStrategyForLayer("FREZ_135")).toBe("orientation");
  });

  it("returns 'full' for CUT", () => {
    expect(joinStrategyForLayer("CUT")).toBe("full");
  });

  it("returns 'full' for HOLES", () => {
    expect(joinStrategyForLayer("HOLES")).toBe("full");
  });

  it("returns 'full' for unknown/custom layers", () => {
    expect(joinStrategyForLayer("CUSTOM")).toBe("full");
    expect(joinStrategyForLayer("ENGRAVE")).toBe("full");
  });
});

// ── Full Join (CUT, HOLES, custom layers) ────────────────────────────────────

describe("joinSegments — full strategy", () => {
  it("joins two touching horizontal segments", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 10, y1: 5, x2: 20, y2: 5 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 20, y2: 5 }]);
  });

  it("joins two overlapping horizontal segments", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 15, y2: 5 },
        { x1: 10, y1: 5, x2: 20, y2: 5 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 20, y2: 5 }]);
  });

  it("does NOT join two horizontal segments with a gap", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 15, y1: 5, x2: 25, y2: 5 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [
      { x1: 0, y1: 5, x2: 10, y2: 5 },
      { x1: 15, y1: 5, x2: 25, y2: 5 },
    ]);
  });

  it("joins near-touching segments (within 0.01mm tolerance)", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 10.005, y1: 5, x2: 20, y2: 5 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 20, y2: 5 }]);
  });

  it("joins two touching vertical segments", () => {
    const result = joinSegments(
      [
        { x1: 3, y1: 0, x2: 3, y2: 10 },
        { x1: 3, y1: 10, x2: 3, y2: 20 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 3, y1: 0, x2: 3, y2: 20 }]);
  });

  it("joins a chain of three touching horizontal segments", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 0, x2: 5, y2: 0 },
        { x1: 5, y1: 0, x2: 10, y2: 0 },
        { x1: 10, y1: 0, x2: 15, y2: 0 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 0, x2: 15, y2: 0 }]);
  });

  it("joins a chain regardless of input order", () => {
    const result = joinSegments(
      [
        { x1: 10, y1: 0, x2: 15, y2: 0 },
        { x1: 0, y1: 0, x2: 5, y2: 0 },
        { x1: 5, y1: 0, x2: 10, y2: 0 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 0, x2: 15, y2: 0 }]);
  });

  it("does NOT join parallel but non-collinear segments", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 0, y1: 6, x2: 10, y2: 6 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [
      { x1: 0, y1: 5, x2: 10, y2: 5 },
      { x1: 0, y1: 6, x2: 10, y2: 6 },
    ]);
  });

  it("joins two collinear 45° diagonal segments", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 0, x2: 10, y2: 10 },
        { x1: 10, y1: 10, x2: 20, y2: 20 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 0, x2: 20, y2: 20 }]);
  });

  it("joins two overlapping 45° diagonal segments", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 0, x2: 15, y2: 15 },
        { x1: 10, y1: 10, x2: 25, y2: 25 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 0, x2: 25, y2: 25 }]);
  });

  it("filters out zero-length segments", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 5, y1: 5, x2: 5, y2: 5 }, // zero-length
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 10, y2: 5 }]);
  });

  it("returns empty array for empty input", () => {
    expect(joinSegments([], "full")).toEqual([]);
  });

  it("returns single segment unchanged", () => {
    const seg: Segment = { x1: 0, y1: 0, x2: 10, y2: 5 };
    expect(joinSegments([seg], "full")).toEqual([seg]);
  });

  it("handles overlapping CUT segments (dedup scenario)", () => {
    // Two parts share a CUT edge at the same position
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 20, y2: 5 },
        { x1: 10, y1: 5, x2: 20, y2: 5 }, // sub-segment of the first
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 20, y2: 5 }]);
  });

  it("keeps non-collinear segments separate", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 0, x2: 10, y2: 0 }, // horizontal
        { x1: 5, y1: 0, x2: 5, y2: 10 }, // vertical (perpendicular)
      ],
      "full",
    );
    expect(result.length).toBe(2);
  });

  it("multi-pass chain: joins segments that become adjacent after merging", () => {
    // A overlaps B, B overlaps C, but A doesn't touch C directly
    // After merging A+B, the result touches C
    const result = joinSegments(
      [
        { x1: 0, y1: 0, x2: 6, y2: 0 },
        { x1: 4, y1: 0, x2: 10, y2: 0 },
        { x1: 10, y1: 0, x2: 15, y2: 0 },
      ],
      "full",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 0, x2: 15, y2: 0 }]);
  });
});

// ── Orientation-Aware Join (FREZ, FREZ_135) ──────────────────────────────────

describe("joinSegments — orientation strategy", () => {
  it("joins two touching horizontal FREZ lines", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 10, y1: 5, x2: 20, y2: 5 },
      ],
      "orientation",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 20, y2: 5 }]);
  });

  it("joins two touching vertical FREZ lines", () => {
    const result = joinSegments(
      [
        { x1: 3, y1: 0, x2: 3, y2: 10 },
        { x1: 3, y1: 10, x2: 3, y2: 20 },
      ],
      "orientation",
    );
    expectSegmentsEqual(result, [{ x1: 3, y1: 0, x2: 3, y2: 20 }]);
  });

  it("joins two collinear 45° diagonal FREZ lines", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 0, x2: 10, y2: 10 },
        { x1: 10, y1: 10, x2: 20, y2: 20 },
      ],
      "orientation",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 0, x2: 20, y2: 20 }]);
  });

  it("does NOT join horizontal and diagonal FREZ lines", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 10, x2: 20, y2: 10 }, // horizontal
        { x1: 5, y1: 0, x2: 15, y2: 10 }, // diagonal
      ],
      "orientation",
    );
    expect(result.length).toBe(2);
  });

  it("does NOT join 33° and 45° FREZ lines", () => {
    // 33° line: tan(33°) ≈ 0.649, so from (0,0) to (10,6.49)
    const result = joinSegments(
      [
        { x1: 0, y1: 0, x2: 10, y2: 6.49 }, // ~33°
        { x1: 5, y1: 0, x2: 15, y2: 10 }, // 45°
      ],
      "orientation",
    );
    expect(result.length).toBe(2);
  });

  it("keeps horizontal and vertical FREZ lines separate", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 }, // horizontal
        { x1: 3, y1: 0, x2: 3, y2: 10 }, // vertical
      ],
      "orientation",
    );
    expect(result.length).toBe(2);
  });

  it("keeps horizontals at different Y separate", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 0, y1: 6, x2: 10, y2: 6 },
      ],
      "orientation",
    );
    expect(result.length).toBe(2);
  });

  it("joins multiple overlapping horizontals", () => {
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 10, y1: 5, x2: 20, y2: 5 },
        { x1: 5, y1: 5, x2: 25, y2: 5 },
      ],
      "orientation",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 25, y2: 5 }]);
  });

  it("groups lines by angle and joins within groups", () => {
    // Two horizontals (joinable) + two verticals (joinable within their group)
    const result = joinSegments(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 }, // h1
        { x1: 10, y1: 5, x2: 20, y2: 5 }, // h2 (same angle as h1)
        { x1: 3, y1: 0, x2: 3, y2: 10 }, // v1
        { x1: 3, y1: 10, x2: 3, y2: 20 }, // v2 (same angle as v1)
      ],
      "orientation",
    );
    expect(result.length).toBe(2); // one merged horizontal, one merged vertical
  });
});

// ── Skip Strategy ────────────────────────────────────────────────────────────

describe("joinSegments — skip strategy", () => {
  it("returns segments unchanged", () => {
    const segs: Segment[] = [
      { x1: 0, y1: 5, x2: 10, y2: 5 },
      { x1: 10, y1: 5, x2: 20, y2: 5 },
    ];
    expect(joinSegments(segs, "skip")).toEqual(segs);
  });

  it("works with empty array", () => {
    expect(joinSegments([], "skip")).toEqual([]);
  });
});

// ── joinSegmentsForLayer ──────────────────────────────────────────────────────

describe("joinSegmentsForLayer", () => {
  it("applies full join to CUT layer", () => {
    const result = joinSegmentsForLayer(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 10, y1: 5, x2: 20, y2: 5 },
      ],
      "CUT",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 20, y2: 5 }]);
  });

  it("applies orientation join to FREZ layer", () => {
    const result = joinSegmentsForLayer(
      [
        { x1: 0, y1: 5, x2: 10, y2: 5 },
        { x1: 10, y1: 5, x2: 20, y2: 5 },
      ],
      "FREZ",
    );
    expectSegmentsEqual(result, [{ x1: 0, y1: 5, x2: 20, y2: 5 }]);
  });

  it("skips SHEETS layer", () => {
    const segs: Segment[] = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 200, y2: 0 },
    ];
    expect(joinSegmentsForLayer(segs, "SHEETS")).toEqual(segs);
  });

  it("skips '0' layer", () => {
    const segs: Segment[] = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 200, y2: 0 },
    ];
    expect(joinSegmentsForLayer(segs, "0")).toEqual(segs);
  });
});