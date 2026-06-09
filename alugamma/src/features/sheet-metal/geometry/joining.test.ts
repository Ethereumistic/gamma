// ────────────────────────────────────────────────────────────────────────────────
// Sheet-Metal — Per-Part Layer Joining Tests
// ────────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { joinStrategyForLayer, joinShapesPerLayer } from "./joining";
import type { LineShape } from "@/features/sheet-metal/types";

// ── Strategy table ──────────────────────────────────────────────────────────

describe("joinStrategyForLayer", () => {
  it("returns 'full' for CUT", () => {
    expect(joinStrategyForLayer("CUT")).toBe("full");
  });

  it("returns 'orientation' for FREZ", () => {
    expect(joinStrategyForLayer("FREZ")).toBe("orientation");
  });

  it("returns 'orientation' for FREZ_135", () => {
    expect(joinStrategyForLayer("FREZ_135")).toBe("orientation");
  });

  it("returns 'full' for HOLES", () => {
    expect(joinStrategyForLayer("HOLES")).toBe("full");
  });

  it("returns 'skip' for '0'", () => {
    expect(joinStrategyForLayer("0")).toBe("skip");
  });

  it("returns 'skip' for SHEETS", () => {
    expect(joinStrategyForLayer("SHEETS")).toBe("skip");
  });

  it("returns 'full' for unknown/custom layers", () => {
    expect(joinStrategyForLayer("CUSTOM")).toBe("full");
  });
});

// ── joinShapesPerLayer ──────────────────────────────────────────────────────

describe("joinShapesPerLayer", () => {
  it("returns empty for empty input", () => {
    expect(joinShapesPerLayer([])).toEqual({});
  });

  it("groups shapes by layer and applies correct strategy", () => {
    const shapes: LineShape[] = [
      // Two touching FREZ horizontals (should be orientation-joined)
      { type: "line", layer: "FREZ", x1: 0, y1: 5, x2: 10, y2: 5 },
      { type: "line", layer: "FREZ", x1: 10, y1: 5, x2: 20, y2: 5 },
      // Two touching CUT horizontals (should be full-joined)
      { type: "line", layer: "CUT", x1: 0, y1: 0, x2: 10, y2: 0 },
      { type: "line", layer: "CUT", x1: 10, y1: 0, x2: 20, y2: 0 },
      // Layer 0 lines (should be skipped)
      { type: "line", layer: "0", x1: 0, y1: 10, x2: 100, y2: 10 },
      { type: "line", layer: "0", x1: 100, y1: 10, x2: 200, y2: 10 },
    ];

    const result = joinShapesPerLayer(shapes);

    // FREZ: two touching horizontals → 1 merged line
    expect(result.FREZ).toHaveLength(1);
    expect(result.FREZ![0].x1).toBeCloseTo(0, 2);
    expect(result.FREZ![0].x2).toBeCloseTo(20, 2);

    // CUT: two touching horizontals → 1 merged line
    expect(result.CUT).toHaveLength(1);
    expect(result.CUT![0].x1).toBeCloseTo(0, 2);
    expect(result.CUT![0].x2).toBeCloseTo(20, 2);

    // Layer 0: skipped (not joined, just passed through as-is)
    expect(result["0"]).toHaveLength(2);
  });

  it("4 horizontal + 4 vertical FREZ segments → 1 horizontal + 1 vertical (per part)", () => {
    const shapes: LineShape[] = [
      // 4 horizontal FREZ segments forming a line
      { type: "line", layer: "FREZ", x1: 0, y1: 10, x2: 5, y2: 10 },
      { type: "line", layer: "FREZ", x1: 5, y1: 10, x2: 10, y2: 10 },
      { type: "line", layer: "FREZ", x1: 10, y1: 10, x2: 15, y2: 10 },
      { type: "line", layer: "FREZ", x1: 15, y1: 10, x2: 20, y2: 10 },
      // 4 vertical FREZ segments forming a line
      { type: "line", layer: "FREZ", x1: 5, y1: 0, x2: 5, y2: 3 },
      { type: "line", layer: "FREZ", x1: 5, y1: 3, x2: 5, y2: 6 },
      { type: "line", layer: "FREZ", x1: 5, y1: 6, x2: 5, y2: 9 },
      { type: "line", layer: "FREZ", x1: 5, y1: 9, x2: 5, y2: 12 },
    ];

    const result = joinShapesPerLayer(shapes);

    // FREZ: 2 orientation groups (horizontal + vertical), each merged
    expect(result.FREZ).toHaveLength(2);

    // One should be horizontal (Δy≈0), one vertical (Δx≈0)
    const horizontal = result.FREZ.find(
      (s) => Math.abs(s.y2 - s.y1) < 0.01,
    );
    const vertical = result.FREZ.find(
      (s) => Math.abs(s.x2 - s.x1) < 0.01,
    );
    expect(horizontal).toBeDefined();
    expect(vertical).toBeDefined();
  });
});