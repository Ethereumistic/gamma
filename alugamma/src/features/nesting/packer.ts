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

      if (part.allowedRotation === 0 || part.allowedRotation === 180) {
        // 0° or 180° — same dimensions, no swap
        w = part.cutWidth;
        h = part.cutHeight;
        rotated = false;
      } else if (part.allowedRotation === 90 || part.allowedRotation === 270) {
        // 90° or 270° — swapped dimensions
        w = part.cutHeight;
        h = part.cutWidth;
        rotated = true;
      } else {
        // Both orientations allowed (allowedRotation === -1)
        // Pass natural dims, let packer decide
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

// ── Layout fingerprint for deduplication ──────────────────────────────────
// Two layouts are considered identical if they have the same mode, alignment,
// and the same set of placements (same part types at same positions with
// same dimensions and rotations). The instanceIndex is excluded because it
// is just a sequential numbering artifact — two bins packed with identical
// parts will have different instanceIndex values but the same arrangement.

function layoutFingerprint(layout: {
  mode: string;
  alignment: string;
  placements: Placement[];
}): string {
  const entries = layout.placements
    .map((pl) =>
      `${pl.partId}:${pl.packX.toFixed(2)}:${pl.packY.toFixed(2)}:${pl.rotation}:${pl.packWidth.toFixed(2)}:${pl.packHeight.toFixed(2)}`
    )
    .sort()
    .join("|");
  return `${layout.mode}|${layout.alignment}|${entries}`;
}

// ── Deduplicate identical layouts ────────────────────────────────────────
// When the packer distributes many instances of the same part across multiple
// bins, those bins will have identical arrangements. Rather than outputting
// N separate DXF files (each cut once), we merge them into 1 DXF file cut N
// times. This is both correct and practical: the CNC operator gets fewer
// programs and the sheet list clearly shows the repeat count.
//
// The dedup groups layouts by fingerprint (same mode + alignment + placement
// positions), keeps one representative per group, and sums their
// repeatCounts.

function deduplicateLayouts(layouts: SheetLayout[]): SheetLayout[] {
  if (layouts.length <= 1) return layouts;

  // Group by fingerprint
  const groups = new Map<string, SheetLayout[]>();
  for (const layout of layouts) {
    const fp = layoutFingerprint(layout);
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp)!.push(layout);
  }

  // Merge each group: keep one representative, sum repeatCounts
  const merged: SheetLayout[] = [];
  for (const group of groups.values()) {
    const rep = { ...group[0] };
    rep.repeatCount = group.reduce((sum, l) => sum + l.repeatCount, 0);
    merged.push(rep);
  }

  // Renumber sequentially and recompute sheet names
  merged.sort((a, b) => a.sheetIndex - b.sheetIndex);
  for (let i = 0; i < merged.length; i++) {
    merged[i] = {
      ...merged[i],
      sheetIndex: i,
      id: createLayoutId(i),
      sheetName: `${i + 1}_r${merged[i].repeatCount}_${merged[i].mode}_p${merged[i].placements.length}_u${merged[i].utilizationPercent}`,
    };
  }

  return merged;
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
      // For locked rotations (0/90/180/270), use the part's fixed rotation directly.
      // For free rotation (allowedRotation=-1), use packer's swap decision.
      let rotationDeg: 0 | 90 | 180 | 270;
      if (part.allowedRotation === -1) {
        rotationDeg = rect.rotated ? 90 : 0;
      } else {
        rotationDeg = part.allowedRotation as 0 | 90 | 180 | 270;
      }

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

    // Compute utilization
    const utilizationPercent = Math.round(computeLayoutUtilization(placements));

    // Assign temporary sheet name (will be recomputed after dedup)
    const sheetName = `${bi + 1}_r1_${mode}_p${placements.length}_u${utilizationPercent}`;

    layouts.push({
      id: createLayoutId(bi),
      sheetIndex: bi,
      mode,
      alignment,
      placements,
      repeatCount: 1, // The packer already distributed all required instances across bins.
                          // Cutting each layout once produces exactly the right quantities.
                          // Dedup below will merge identical layouts and sum repeatCounts.
      sheetName,
      offsetX,
      offsetY,
      dedupedCutSegments: [], // will be populated by deduplicator
      utilizationPercent,
    });
  }

  // Deduplicate identical layouts — when the packer creates multiple bins
  // with identical arrangements (common for parts with count > fits-per-sheet),
  // merge them into a single layout with a summed repeatCount.
  // This produces the correct total-sheets-to-cut and avoids spurious
  // OVER-PRODUCED warnings.
  const dedupedLayouts = deduplicateLayouts(layouts);

  // Validate production against the final (deduped) layouts
  const warnings = validateProduction(dedupedLayouts, parts);

  return { layouts: dedupedLayouts, mode, warnings };
}