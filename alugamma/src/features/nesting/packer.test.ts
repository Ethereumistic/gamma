// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Packer Tests
// Validates repeat-count computation and layout deduplication.
// ────────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { packAllParts } from "./packer";
import { createNestPart } from "./types";

// ── Helper to create a test part with specific dimensions ────────────────

function makePart(name: string, l0Width: number, l0Height: number, count: number, direction: "T" | "R" | "B" | "L" | null = null) {
  return createNestPart({
    name,
    filename: direction ? `${name}_${direction}_x${count}` : `${name}_x${count}`,
    direction,
    count,
    l0Width,
    l0Height,
    source: "custom-dxf",
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("packAllParts — repeat count & deduplication", () => {
  it("single part ×20 that fits 5 per sheet → 1 layout, repeat=4, total=4 sheets", () => {
    // gabrovo scenario: 1121×566 mm part → 5 fit per 1180×3130 usable sheet
    const parts = [makePart("gabrovo", 1115, 560, 20)];
    const { layouts, warnings, mode } = packAllParts(parts);

    // Should produce exactly 1 unique layout (deduped from 4 identical bins)
    expect(layouts.length).toBe(1);

    // The repeat count should be 4 (cut the same sheet 4 times)
    expect(layouts[0].repeatCount).toBe(4);

    // 5 placements per sheet
    expect(layouts[0].placements.length).toBe(5);

    // Total sheets = 1 layout × 4 repeat = 4
    const totalSheets = layouts.reduce((sum, l) => sum + l.repeatCount, 0);
    expect(totalSheets).toBe(4);

    // No over/under-production warnings
    expect(warnings).toEqual([]);

    // Mode A (fits in margin area)
    expect(mode).toBe("A");
  });

  it("single part ×1 that fits 5 per sheet → 1 layout, repeat=1, total=1 sheet", () => {
    const parts = [makePart("panel", 1115, 560, 1)];
    const { layouts, warnings } = packAllParts(parts);

    expect(layouts.length).toBe(1);
    expect(layouts[0].repeatCount).toBe(1);
    expect(layouts[0].placements.length).toBe(1);

    const totalSheets = layouts.reduce((sum, l) => sum + l.repeatCount, 0);
    expect(totalSheets).toBe(1);
    expect(warnings).toEqual([]);
  });

  it("single part ×10 that fits multiple per sheet → deduped, correct repeat, no over-production", () => {
    // Large part, fits multiple per sheet
    const parts = [makePart("large", 580, 1500, 10)];
    const { layouts, warnings } = packAllParts(parts);

    // Total production must be exactly 10
    const totalProduced = layouts.reduce(
      (sum, l) => sum + l.placements.length * l.repeatCount,
      0,
    );
    expect(totalProduced).toBe(10);

    // No over/under-production warnings
    expect(warnings).toEqual([]);

    // Total sheets should equal sum of repeatCounts
    const totalSheets = layouts.reduce((sum, l) => sum + l.repeatCount, 0);
    expect(totalSheets).toBeGreaterThan(0);
  });

  it("single part ×1 → 1 layout, repeat=1, 1 placement", () => {
    const parts = [makePart("solo", 200, 200, 1)];
    const { layouts, warnings } = packAllParts(parts);

    expect(layouts.length).toBe(1);
    expect(layouts[0].repeatCount).toBe(1);
    expect(layouts[0].placements.length).toBe(1);
    expect(warnings).toEqual([]);
  });

  it("multiple parts with different counts — no over-production", () => {
    // Two part types that fit together on a sheet
    const parts = [
      makePart("bracket", 400, 300, 6),
      makePart("plate", 400, 300, 4),
    ];
    const { layouts, warnings } = packAllParts(parts);

    // Total production should match demand exactly
    const producedA = layouts.reduce(
      (sum, l) =>
        sum + l.placements.filter((p) => p.partId === parts[0].id).length * l.repeatCount,
      0,
    );
    const producedB = layouts.reduce(
      (sum, l) =>
        sum + l.placements.filter((p) => p.partId === parts[1].id).length * l.repeatCount,
      0,
    );

    expect(producedA).toBe(6);
    expect(producedB).toBe(4);

    // Check that total sheets equals the sum of repeatCounts
    const totalSheets = layouts.reduce((sum, l) => sum + l.repeatCount, 0);
    // Total placements should be 10 (6A + 4B total instances packed)
    const totalPlacements = layouts.reduce(
      (sum, l) => sum + l.placements.length * l.repeatCount,
      0,
    );
    expect(totalPlacements).toBe(10);
    expect(totalSheets).toBeGreaterThan(0);

    // No over/under-production warnings
    expect(warnings).toEqual([]);
  });

  it("large count (×100) produces correct total without massive duplication", () => {
    // A small part that fits many per sheet
    const parts = [makePart("clip", 100, 100, 100)];
    const { layouts, warnings } = packAllParts(parts);

    // Total produced should equal 100
    const totalProduced = layouts.reduce(
      (sum, l) => sum + l.placements.length * l.repeatCount,
      0,
    );
    expect(totalProduced).toBe(100);

    // No warnings
    expect(warnings).toEqual([]);
  });

  it("sheet name format includes correct repeat count after dedup", () => {
    const parts = [makePart("gabrovo", 1115, 560, 20)];
    const { layouts } = packAllParts(parts);

    // Sheet name: {num}_r{repeat}_{mode}_p{count}_u{util}
    expect(layouts[0].sheetName).toMatch(/^1_r4_A_p5_u\d+$/);
  });

  it("produces no OVER-PRODUCED warning for exact production", () => {
    // This is the exact scenario the user reported
    const parts = [makePart("gabrovo_x20_T", 1115, 560, 20, "T")];
    const { warnings } = packAllParts(parts);

    const overProduced = warnings.filter((w) => w.includes("OVER-PRODUCED"));
    const underProduced = warnings.filter((w) => w.includes("UNDER-PRODUCED"));

    expect(overProduced).toEqual([]);
    expect(underProduced).toEqual([]);
  });
});

describe("packAllParts — edge cases", () => {
  it("empty parts → empty layouts", () => {
    const { layouts, warnings } = packAllParts([]);
    expect(layouts).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("part count larger than what fits in max sheets still packs", () => {
    // Very high count of a medium part
    const parts = [makePart("medium", 200, 200, 200)];
    const { layouts, warnings } = packAllParts(parts);

    // Total produced should match count
    const totalProduced = layouts.reduce(
      (sum, l) => sum + l.placements.length * l.repeatCount,
      0,
    );
    expect(totalProduced).toBe(200);
  });
});