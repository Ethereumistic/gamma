// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — MaxRects Bin Packing Engine
// Pure TypeScript implementation. No external dependencies.
//
// Algorithm: MaxRects with multiple heuristics (BSSF, BAF, BLSF).
// Run all three, keep the result with fewest sheets.
//
// Plan refs: PLAN_02, PLAN_0 §3
// ────────────────────────────────────────────────────────────────────────────────

import {
  SHEET_WIDTH,
  SHEET_HEIGHT,
  USABLE_WIDTH,
  USABLE_HEIGHT,
  MARGIN,
  BOTTOM_LEFT_THRESHOLD,
  MAX_SHEETS,
} from "./constants";
import {
  type NestPart,
  type PackItem,
  type FreeRect,
  type PackResult,
  type Placement,
  type SheetLayout,
  type PackingMode,
  type LayoutAlignment,
  type PackedBin,
  computeLayoutUtilization,
  detectPackingMode,
  createLayoutId,
} from "./types";

// ── Free-rectangle management ─────────────────────────────────────────────

function containsRect(outer: FreeRect, inner: FreeRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function splitFreeRect(free: FreeRect, placed: FreeRect): FreeRect[] {
  const results: FreeRect[] = [];

  // If they don't overlap, the free rect is unaffected
  if (
    placed.x >= free.x + free.w ||
    placed.x + placed.w <= free.x ||
    placed.y >= free.y + free.h ||
    placed.y + placed.h <= free.y
  ) {
    return [free];
  }

  // Split the free rect into up to 4 sub-rectangles around the placed rect
  // Left
  if (placed.x > free.x) {
    results.push({
      x: free.x,
      y: free.y,
      w: placed.x - free.x,
      h: free.h,
    });
  }
  // Right
  if (placed.x + placed.w < free.x + free.w) {
    results.push({
      x: placed.x + placed.w,
      y: free.y,
      w: free.x + free.w - placed.x - placed.w,
      h: free.h,
    });
  }
  // Bottom
  if (placed.y > free.y) {
    results.push({
      x: free.x,
      y: free.y,
      w: free.w,
      h: placed.y - free.y,
    });
  }
  // Top
  if (placed.y + placed.h < free.y + free.h) {
    results.push({
      x: free.x,
      y: placed.y + placed.h,
      w: free.w,
      h: free.y + free.h - placed.y - placed.h,
    });
  }

  return results;
}

// ── Heuristic scoring ──────────────────────────────────────────────────────

type HeuristicType = "bssf" | "baf" | "blsf";

interface BestPosition {
  x: number;
  y: number;
  w: number; // actual width (may be swapped if rotated)
  h: number; // actual height (may be swapped if rotated)
  scorePrimary: number;
  scoreSecondary: number;
  rotated: boolean;
  freeRectIndex: number;
}

function findBestPosition(
  width: number,
  height: number,
  freeRects: FreeRect[],
  bins: FreeRect[],
  allowRotation: boolean,
  heuristic: HeuristicType,
): BestPosition | null {
  let best: BestPosition | null = null;

  // Try both orientations for rotation-free items, or just the locked orientation
  const orientations: Array<{ w: number; h: number; rotated: boolean }> = allowRotation
    ? [
        { w: width, h: height, rotated: false },
        { w: height, h: width, rotated: true },
      ]
    : [{ w: width, h: height, rotated: false }];

  for (const orient of orientations) {
    const { w, h, rotated } = orient;

    // Check existing bins
    const allFree = [...freeRects, ...bins];

    for (let fi = 0; fi < allFree.length; fi++) {
      const fr = allFree[fi];

      if (w > fr.w || h > fr.h) continue;

      // This rectangle can fit in this free rect
      // Calculate scores based on heuristic
      let scorePrimary: number;
      let scoreSecondary: number;

      switch (heuristic) {
        case "bssf": {
          // Best Short Side Fit: minimize the shorter leftover side
          const leftoverH = fr.w - w;
          const leftoverV = fr.h - h;
          scorePrimary = Math.min(leftoverH, leftoverV);
          scoreSecondary = Math.max(leftoverH, leftoverV);
          break;
        }
        case "baf": {
          // Best Area Fit: minimize leftover area
          scorePrimary = fr.w * fr.h - w * h;
          scoreSecondary = Math.min(fr.w - w, fr.h - h);
          break;
        }
        case "blsf": {
          // Best Long Side Fit: minimize the longer leftover side
          const leftoverH2 = fr.w - w;
          const leftoverV2 = fr.h - h;
          scorePrimary = Math.max(leftoverH2, leftoverV2);
          scoreSecondary = Math.min(leftoverH2, leftoverV2);
          break;
        }
      }

      const candidate: BestPosition = {
        x: fr.x,
        y: fr.y,
        w,
        h,
        scorePrimary,
        scoreSecondary,
        rotated,
        freeRectIndex: fi,
      };

      if (
        !best ||
        candidate.scorePrimary < best.scorePrimary ||
        (candidate.scorePrimary === best.scorePrimary &&
          candidate.scoreSecondary < best.scoreSecondary)
      ) {
        best = candidate;
      }
    }
  }

  return best;
}

// ── MaxRects Packer Class ──────────────────────────────────────────────────

class MaxRectsPacker {
  private binWidth: number;
  private binHeight: number;
  private freeRects: FreeRect[][] = []; // One array of free rects per bin
  private placedRects: PackResult[][] = []; // Placed rects per bin

  constructor(binWidth: number, binHeight: number) {
    this.binWidth = binWidth;
    this.binHeight = binHeight;
  }

  insert(
    w: number,
    h: number,
    rid: string,
    allowRotation: boolean,
    heuristic: HeuristicType,
  ): PackResult | null {
    // Find the best position across all bins
    let bestPos: BestPosition | null = null;
    let bestBinIndex = -1;

    for (let bi = 0; bi < this.freeRects.length; bi++) {
      const pos = findBestPosition(
        w,
        h,
        this.freeRects[bi],
        [], // no "new bin" free rects here — we handle that separately
        allowRotation,
        heuristic,
      );
      if (pos && (!bestPos || pos.scorePrimary < bestPos.scorePrimary ||
        (pos.scorePrimary === bestPos.scorePrimary && pos.scoreSecondary < bestPos.scoreSecondary))) {
        bestPos = pos;
        bestBinIndex = bi;
      }
    }

    // Check if a new bin would be better
    if (this.freeRects.length < MAX_SHEETS) {
      const newBinFree: FreeRect = { x: 0, y: 0, w: this.binWidth, h: this.binHeight };
      const allFree = [newBinFree];
      const newPos = findBestPosition(
        w,
        h,
        allFree,
        [],
        allowRotation,
        heuristic,
      );
      if (newPos) {
        // Prefer a new bin only if it's better or no existing bin can fit
        if (!bestPos || newPos.scorePrimary < bestPos.scorePrimary ||
          (newPos.scorePrimary === bestPos.scorePrimary && newPos.scoreSecondary < bestPos.scoreSecondary)) {
          // Accept new bin placement
          bestPos = newPos;
          bestBinIndex = this.freeRects.length;
        }
      }
    }

    if (!bestPos) return null;

    // If this needs a new bin, create it
    if (bestBinIndex === this.freeRects.length) {
      this.freeRects.push([{ x: 0, y: 0, w: this.binWidth, h: this.binHeight }]);
      this.placedRects.push([]);
    }

    // Place the rectangle
    const placed: PackResult = {
      x: bestPos.x,
      y: bestPos.y,
      width: bestPos.w,
      height: bestPos.h,
      rid,
      rotated: bestPos.rotated,
    };

    this.placedRects[bestBinIndex].push(placed);

    // Split all free rectangles that overlap with the placed rect
    const placedRect: FreeRect = {
      x: bestPos.x,
      y: bestPos.y,
      w: bestPos.w,
      h: bestPos.h,
    };

    const newFree: FreeRect[] = [];
    for (const fr of this.freeRects[bestBinIndex]) {
      const splits = splitFreeRect(fr, placedRect);
      for (const s of splits) {
        // Only keep if it has positive area
        if (s.w > 0 && s.h > 0) {
          newFree.push(s);
        }
      }
    }

    // Prune: remove free rects contained in other free rects
    const prunedFree: FreeRect[] = [];
    for (let i = 0; i < newFree.length; i++) {
      let contained = false;
      for (let j = 0; j < newFree.length; j++) {
        if (i !== j && containsRect(newFree[j], newFree[i])) {
          contained = true;
          break;
        }
      }
      if (!contained) {
        prunedFree.push(newFree[i]);
      }
    }

    this.freeRects[bestBinIndex] = prunedFree;
    return placed;
  }

  getResults(): PackedBin[] {
    return this.placedRects.map((rects, i) => ({
      binIndex: i,
      rects: [...rects],
    }));
  }

  getBinCount(): number {
    return this.placedRects.length;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

function runSinglePacker(
  items: PackItem[],
  binW: number,
  binH: number,
  heuristic: HeuristicType,
): PackedBin[] {
  const packer = new MaxRectsPacker(binW, binH);

  for (const item of items) {
    const allowRotation = item.partData.allowedRotation === -1;
    const result = packer.insert(item.w, item.h, item.rid, allowRotation, heuristic);
    if (!result) {
      console.error(
        `[NESTING] Failed to place part "${item.partName}" (instance ${item.instanceIndex}). ` +
        `Dimensions: ${item.w}×${item.h}mm. This part will be missing from the output.`
      );
    }
  }

  return packer.getResults();
}

function buildItems(parts: NestPart[]): PackItem[] {
  const items: PackItem[] = [];
  let counter = 0;

  for (const part of parts) {
    for (let i = 0; i < part.count; i++) {
      const rid = `${part.id}_${i}`;
      let w: number;
      let h: number;
      let rotated: boolean;

      if (part.allowedRotation === 0) {
        // Upright only
        w = part.cutWidth;
        h = part.cutHeight;
        rotated = false;
      } else if (part.allowedRotation === 90) {
        // Rotated 90° only: swap dimensions
        w = part.cutHeight;
        h = part.cutWidth;
        rotated = true;
      } else {
        // Both orientations allowed — pass natural dims, let packer decide
        w = part.cutWidth;
        h = part.cutHeight;
        rotated = false;
      }

      items.push({
        rid,
        partId: part.id,
        partName: part.name,
        instanceIndex: i,
        w,
        h,
        rotated,
        partData: part,
      });
    }
  }

  // Sort by area descending — critical for packing quality
  items.sort((a, b) => b.w * b.h - a.w * a.h);

  return items;
}

function computeRepeatCount(
  placements: Placement[],
  parts: NestPart[],
): number {
  // Count instances of each part type on this sheet
  const instanceCounts = new Map<string, number>();
  for (const pl of placements) {
    instanceCounts.set(pl.partId, (instanceCounts.get(pl.partId) ?? 0) + 1);
  }

  // For each part type on this sheet, how many times does this sheet need to be cut?
  const repeatsNeeded: number[] = [];
  const partMap = new Map(parts.map((p) => [p.id, p]));

  for (const [partId, countOnSheet] of instanceCounts) {
    const part = partMap.get(partId);
    if (!part) continue;
    repeatsNeeded.push(Math.ceil(part.count / countOnSheet));
  }

  return repeatsNeeded.length > 0 ? Math.min(...repeatsNeeded) : 1;
}

function validateProduction(
  layouts: SheetLayout[],
  parts: NestPart[],
): string[] {
  const produced = new Map<string, number>();
  const partMap = new Map(parts.map((p) => [p.id, p]));

  for (const layout of layouts) {
    const instanceCounts = new Map<string, number>();
    for (const pl of layout.placements) {
      instanceCounts.set(pl.partId, (instanceCounts.get(pl.partId) ?? 0) + 1);
    }
    for (const [partId, countOnSheet] of instanceCounts) {
      produced.set(partId, (produced.get(partId) ?? 0) + countOnSheet * layout.repeatCount);
    }
  }

  const warnings: string[] = [];
  for (const part of parts) {
    const actual = produced.get(part.id) ?? 0;
    const required = part.count;
    if (actual < required) {
      warnings.push(
        `UNDER-PRODUCED: ${part.filename} needs ${required}, but only ${actual} will be cut.`,
      );
    } else if (actual > required) {
      warnings.push(
        `OVER-PRODUCED: ${part.filename} needs ${required}, but ${actual} will be cut (acceptable waste).`,
      );
    }
  }
  return warnings;
}

export function packAllParts(parts: NestPart[]): {
  layouts: SheetLayout[];
  mode: PackingMode;
  warnings: string[];
} {
  if (parts.length === 0) {
    return { layouts: [], mode: "A", warnings: [] };
  }

  const mode = detectPackingMode(parts);

  const binW = mode === "A" ? USABLE_WIDTH : SHEET_WIDTH;
  const binH = mode === "A" ? USABLE_HEIGHT : SHEET_HEIGHT;

  const items = buildItems(parts);

  // Run all three heuristics, keep the best result (fewest sheets)
  const heuristics: HeuristicType[] = ["bssf", "baf", "blsf"];
  let bestBins: PackedBin[] = [];
  let bestBinCount = Infinity;

  for (const heuristic of heuristics) {
    const bins = runSinglePacker(items, binW, binH, heuristic);
    // Filter out empty bins
    const nonEmpty = bins.filter((b) => b.rects.length > 0);
    if (nonEmpty.length < bestBinCount || bestBinCount === Infinity) {
      bestBinCount = nonEmpty.length;
      bestBins = nonEmpty;
    }
  }

  // Build SheetLayouts from packed bins
  const itemMap = new Map(items.map((it) => [it.rid, it]));
  const layouts: SheetLayout[] = [];

  for (let bi = 0; bi < bestBins.length; bi++) {
    const bin = bestBins[bi];
    if (bin.rects.length === 0) continue;

    const placements: Placement[] = [];

    for (const rect of bin.rects) {
      const item = itemMap.get(rect.rid);
      if (!item) continue;

      const part = item.partData;

      // The packer explicitly reports whether it swapped w↔h for this item.
      // This is more reliable than comparing dimensions (which fails for near-square parts).
      const rotationDeg: 0 | 90 = rect.rotated || item.rotated ? 90 : 0;

      placements.push({
        partId: part.id,
        instanceIndex: item.instanceIndex,
        packX: rect.x,
        packY: rect.y,
        packWidth: rect.width,
        packHeight: rect.height,
        rotation: rotationDeg,
      });
    }

    // Compute alignment offset
    let offsetX: number;
    let offsetY: number;
    let alignment: LayoutAlignment;

    if (mode === "B") {
      const layoutW = Math.max(...placements.map((pl) => pl.packX + pl.packWidth));
      const layoutH = Math.max(...placements.map((pl) => pl.packY + pl.packHeight));
      const utilization = computeLayoutUtilization(placements);

      if (utilization < BOTTOM_LEFT_THRESHOLD) {
        // Low utilization: anchor at bottom-left.
        // X: push toward left edge with MARGIN, clamped so nothing exceeds sheet.
        // Y: push toward bottom edge (high Y in canvas coords where Y↓) with MARGIN
        //    from the bottom, clamped so nothing exceeds sheet. This makes the
        //    layout appear at the bottom-left of the preview canvas and the DXF.
        offsetX = Math.min(MARGIN, Math.max(0, (SHEET_WIDTH - layoutW) / 2));
        offsetY = Math.max(0, SHEET_HEIGHT - layoutH - Math.min(MARGIN, Math.max(0, (SHEET_HEIGHT - layoutH) / 2)));
        alignment = "bottom-left";
      } else {
        // High utilization: center the layout on the sheet
        offsetX = (SHEET_WIDTH - layoutW) / 2;
        offsetY = (SHEET_HEIGHT - layoutH) / 2;
        alignment = "centered";
      }
    } else {
      offsetX = MARGIN;
      offsetY = MARGIN;
      alignment = "margin";
    }

    // Compute repeat count
    const repeatCount = computeRepeatCount(placements, parts);

    // Compute utilization
    const utilizationPercent = Math.round(computeLayoutUtilization(placements));

    // Assign sheet name using the format: {number}_r{repeat}_{mode}_p{parts}_u{util}
    const sheetName = `${bi + 1}_r${repeatCount}_${mode}_p${placements.length}_u${utilizationPercent}`;

    layouts.push({
      id: createLayoutId(bi),
      sheetIndex: bi,
      mode,
      alignment,
      placements,
      repeatCount,
      sheetName,
      offsetX,
      offsetY,
      dedupedCutSegments: [], // will be populated by deduplicator
      utilizationPercent,
    });
  }

  // Validate production
  const warnings = validateProduction(layouts, parts);

  return { layouts, mode, warnings };
}