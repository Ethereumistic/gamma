# Plan: Mode B Bottom-Left Alignment for Low-Utilization Sheets

> **Goal:** When a Mode B sheet has utilization below 70%, anchor parts at the bottom-left corner with a 35mm offset (x=35, y=35) instead of centering on the sheet. Sheets at ≥70% utilization remain centered.

---

## 1. Root Problem

Currently, all Mode B sheets center their layout on the 1250×3200mm sheet:

```ts
offsetX = (SHEET_WIDTH - layoutW) / 2;
offsetY = (SHEET_HEIGHT - layoutH) / 2;
```

For low-utilization sheets (lots of empty space), centering wastes material on the CNC table and makes the layout harder to clamp. The operator wants low-utilization sheets anchored at the bottom-left corner with the same 35mm margin used in Mode A.

## 2. Key Invariant

**offsetX and offsetY are computed once in `packer.ts`** and stored on `SheetLayout`. Every downstream consumer (DXF writer, preview canvas, deduplicator) reads them from the layout object and never recomputes them. This means we only need to change one location — the packer — and all rendering/export will follow automatically.

The downstream consumers all just passively consume `layout.offsetX` and `layout.offsetY`:

| File | Usage | Needs change? |
|------|-------|---------------|
| `packer.ts` | **Computes** offsetX/offsetY | ✅ Yes |
| `dxf-writer.ts` | Reads `layout.offsetX`, `layout.offsetY` for transforms and guide rectangle | ❌ No |
| `preview-canvas.tsx` | Reads `layout.offsetX`, `layout.offsetY` for drawing | ❌ No |
| `deduplicator.ts` | Receives `offsetX`, `offsetY` as parameters | ❌ No |
| `types.ts` | Defines `SheetLayout.offsetX/Y` | ❌ No |
| `context.tsx` | Passes layouts through | ❌ No |
| `sheet-list.tsx` | Shows `Mode A/B` badge | See step 5 |
| `export-dialog.tsx` | Shows `Mode: Standard Margin / Full Span` | See step 5 |

## 3. Implementation Steps

### Step 1 — Add threshold constant to `constants.ts`

**Why:** Keeps the magic number out of the packer logic. Easy to tune later.

```ts
// In constants.ts, add:

/** Layout utilization threshold below which Mode B sheets use bottom-left
 *  alignment instead of centering. Expressed as a percentage (0–100). */
export const BOTTOM_LEFT_THRESHOLD = 70;
```

### Step 2 — Add a layout utilization helper to `packer.ts`

**Why:** We need to compute per-sheet utilization. Currently the context computes a cross-layout average; we need per-layout values.

Add a local helper at the top of `packer.ts` (or as a private function), near `computeRepeatCount`:

```ts
/** Compute the material utilization percentage for a single layout.
 *  Returns: (total part area / sheet area) × 100 */
function computeLayoutUtilization(placements: Placement[]): number {
  const sheetArea = SHEET_WIDTH * SHEET_HEIGHT;
  const partArea = placements.reduce(
    (sum, pl) => sum + pl.packWidth * pl.packHeight,
    0,
  );
  return (partArea / sheetArea) * 100;
}
```

### Step 3 — Change the offset computation in `packAllParts()`

**Where:** In `packAllParts()`, inside the per-bin loop, the `if (mode === "B")` block that currently computes `offsetX`/`offsetY`.

**Current code** (lines ~522–529 in `packer.ts`):

```ts
// Compute centering offset for Mode B
let offsetX: number;
let offsetY: number;

if (mode === "B") {
  const layoutW = Math.max(...placements.map((pl) => pl.packX + pl.packWidth));
  const layoutH = Math.max(...placements.map((pl) => pl.packY + pl.packHeight));
  offsetX = (SHEET_WIDTH - layoutW) / 2;
  offsetY = (SHEET_HEIGHT - layoutH) / 2;
} else {
  offsetX = MARGIN;
  offsetY = MARGIN;
}
```

**New code:**

```ts
// Compute alignment offset
let offsetX: number;
let offsetY: number;

if (mode === "B") {
  const layoutW = Math.max(...placements.map((pl) => pl.packX + pl.packWidth));
  const layoutH = Math.max(...placements.map((pl) => pl.packY + pl.packHeight));
  const utilization = computeLayoutUtilization(placements);

  if (utilization < BOTTOM_LEFT_THRESHOLD) {
    // Low utilization: anchor at bottom-left.
    // X: push toward left edge with MARGIN, clamped so nothing exceeds sheet.
    // Y: push toward bottom edge (high Y in canvas/DXF coords where Y↓)
    //    with MARGIN from bottom, clamped so nothing exceeds sheet.
    offsetX = Math.min(MARGIN, Math.max(0, (SHEET_WIDTH - layoutW) / 2));
    offsetY = Math.max(0, SHEET_HEIGHT - layoutH - Math.min(MARGIN, Math.max(0, (SHEET_HEIGHT - layoutH) / 2)));
  } else {
    // High utilization: center the layout on the sheet
    offsetX = (SHEET_WIDTH - layoutW) / 2;
    offsetY = (SHEET_HEIGHT - layoutH) / 2;
  }
} else {
  offsetX = MARGIN;
  offsetY = MARGIN;
}
```

**Why the clamp?** In Mode B, the packing bin is `1250 × 3200`. If utilization is low but a single part is wide (e.g., `layoutW = 1220`), then `(1250 - 1220) / 2 = 15`, which is less than `MARGIN = 35`. Using `Math.min(MARGIN, 15) = 15` prevents parts from exceeding the X boundary. The same applies for height. This makes the offset smooth: bottom-left when space is ample, gracefully approaching centering as the layout fills the sheet.

### Step 4 — Add `alignment` field to `SheetLayout` in `types.ts`

**Why:** The UI and DXF label need to communicate *why* a sheet is positioned a certain way. A new `alignment` field makes this explicit and avoids guessing from offsets.

```ts
// In types.ts, add:

export type LayoutAlignment = "margin" | "bottom-left" | "centered";

// In SheetLayout, add the field:
export type SheetLayout = {
  id: string;
  sheetIndex: number;
  mode: PackingMode;
  alignments: LayoutAlignment;   // ← NEW
  placements: Placement[];
  repeatCount: number;
  sheetName: string;
  offsetX: number;
  offsetY: number;
  dedupedCutSegments: Segment[];
};
```

### Step 5 — Set `alignment` in `packAllParts()`

In the same offset-computation block in `packer.ts`, set the alignment:

```ts
let offsetX: number;
let offsetY: number;
let alignment: LayoutAlignment;

if (mode === "B") {
  const layoutW = Math.max(...placements.map((pl) => pl.packX + pl.packWidth));
  const layoutH = Math.max(...placements.map((pl) => pl.packY + pl.packHeight));
  const utilization = computeLayoutUtilization(placements);

  if (utilization < BOTTOM_LEFT_THRESHOLD) {
    offsetX = Math.min(MARGIN, Math.max(0, (SHEET_WIDTH - layoutW) / 2));
    offsetY = Math.min(MARGIN, Math.max(0, (SHEET_HEIGHT - layoutH) / 2));
    alignment = "bottom-left";
  } else {
    offsetX = (SHEET_WIDTH - layoutW) / 2;
    offsetY = (SHEET_HEIGHT - layoutH) / 2;
    alignment = "centered";
  }
} else {
  offsetX = MARGIN;
  offsetY = MARGIN;
  alignment = "margin";
}

// ... later in the push:
layouts.push({
  id: createLayoutId(bi),
  sheetIndex: bi,
  mode,
  alignment,       // ← NEW
  placements,
  repeatCount,
  sheetName,
  offsetX,
  offsetY,
  dedupedCutSegments: [],
});
```

### Step 6 — Update the `createEmptyNestJob` default in `types.ts`

Since `SheetLayout` now requires `alignment`, the packer already provides it. No default is needed since layouts are always created by `packAllParts()`. But if there are any test helpers or default layout objects, add `alignment: "margin"` as the default.

### Step 7 — Update `sheet-list.tsx` to show alignment

**Why:** The operator needs to see at a glance whether a sheet is centered or bottom-left aligned.

In the `SheetCard` component, change the Mode badge:

```tsx
// Current:
<Badge variant="outline" className="h-4 px-1.5 text-[9px]">
  Mode {layout.mode}
</Badge>

// New:
<Badge variant="outline" className="h-4 px-1.5 text-[9px]">
  {layout.mode === "A" ? "Margin" : layout.alignment === "centered" ? "Centered" : "Bottom-Left"}
</Badge>
```

### Step 8 — Update `export-dialog.tsx` mode description

**Why:** The export dialog says "Standard Margin" / "Full Span". With the new alignment, Mode B can be "Centered" or "Bottom-Left".

```tsx
// Current:
<span className="font-mono">{job.mode === "A" ? "Standard Margin" : "Full Span"}</span>

// New:
<span className="font-mono">
  {job.mode === "A"
    ? "Standard Margin"
    : job.layouts.every(l => l.alignment === "centered")
      ? "Full Span (Centered)"
      : job.layouts.every(l => l.alignment === "bottom-left")
        ? "Full Span (Bottom-Left)"
        : "Full Span (Mixed)"}
</span>
```

### Step 9 — Update `preview-canvas.tsx` mode indicator line

The canvas draws a mode indicator at the bottom:

```tsx
`Mode ${layout.mode} | ${layout.placements.length} parts | ×${layout.repeatCount}`
```

Change to:

```tsx
`Mode ${layout.mode} (${layout.alignment}) | ${layout.placements.length} parts | ×${layout.repeatCount}`
```

This displays text like: `Mode B (bottom-left) | 12 parts | ×3` or `Mode B (centered) | 8 parts | ×2`.

### Step 10 — Update DXF writer label

The DXF writer currently injects a label `${layout.sheetName}_x${layout.repeatCount}`. Consider appending the alignment for CNC operator visibility:

```ts
// In dxf-writer.ts, the label injection section:
const alignmentLabel = layout.alignment === "centered" ? "C" : layout.alignment === "bottom-left" ? "BL" : "M";
const labelText = `${layout.sheetName}_x${layout.repeatCount}_${alignmentLabel}`;
```

**This step is optional.** The alignment info is already encoded in the part positions. But the label can help the CNC operator quickly verify alignment on the printed drawing.

---

## 4. Edge Cases & Safety

### 4.1 Out-of-bounds protection

The `Math.min(MARGIN, Math.max(0, (SHEET_WIDTH - layoutW) / 2))` clamp ensures:

- **If the layout is small** (e.g., `layoutW = 500`): `(1250-500)/2 = 375`, `Math.min(35, 375) = 35` → bottom-left at (35, 35) ✅
- **If the layout is wide** (e.g., `layoutW = 1220`): `(1250-1220)/2 = 15`, `Math.min(35, 15) = 15` → slightly more centered, but parts stay within [15, 1235] ✅
- **If the layout fills the sheet** (e.g., `layoutW = 1250`): `(1250-1250)/2 = 0`, `Math.min(35, 0) = 0` → offset of 0, parts at (0, 0) to (1250, ...) ✅
- **Negative impossible** because `Math.max(0, ...)` prevents negative offsets ✅

### 4.2 Mode A is unaffected

Mode A always uses `offsetX = offsetY = MARGIN` with a `1180 × 3130` bin. The `alignment` field is set to `"margin"`. No behavior change.

### 4.3 Mixed utilization across sheets

Each sheet layout computes its own utilization independently. A 2-sheet result can have Sheet 1 at 45% utilization (bottom-left) and Sheet 2 at 78% utilization (centered). The `alignment` field on each `SheetLayout` records the decision, so the canvas, DXF writer, and deduplicator all respect it.

### 4.4 Utilization calculation matches the sheet-list card

The `computeLayoutUtilization` function uses the same formula as the `SheetCard` component in `sheet-list.tsx`:

```ts
const utilization = Math.round((partArea / sheetArea) * 100);
```

The only difference: the packer's helper doesn't round (it needs the raw percentage for threshold comparison), while the UI rounds for display. This is fine — `70.4% >= 70` still evaluates correctly whether rounded or not.

### 4.5 Deduplication and coordinate transforms are unaffected

`collectAndDeduplicate()` and `computeInsertPosition()` receive `offsetX` and `offsetY` as parameters. Since we only change what those values are (not how they're consumed), all CUT-line transforms remain correct.

The same applies to the Maker.js transform pipeline: `moveRelative([placement.packX + layout.offsetX, ...])` works regardless of whether `offsetX` was computed for centering or bottom-left alignment.

---

## 5. Files Changed (summary)

| File | Change |
|------|--------|
| `constants.ts` | Add `BOTTOM_LEFT_THRESHOLD = 70` |
| `types.ts` | Add `LayoutAlignment` type, add `alignment` field to `SheetLayout` |
| `packer.ts` | Add `computeLayoutUtilization()`, change offset computation in `packAllParts()` to be utilization-aware, set `alignment` field |
| `sheet-list.tsx` | Show alignment in badge instead of raw mode letter |
| `export-dialog.tsx` | Show alignment in mode description |
| `preview-canvas.tsx` | Append alignment to mode indicator text |
| `dxf-writer.ts` | (Optional) Append alignment code to sheet label |

Files **not** changed (confirmed safe):
- `deduplicator.ts` — receives offsetX/offsetY as parameters, no change needed
- `context.tsx` — passes layouts through, no change needed
- `hotkeys.tsx` — unrelated
| `part-list.tsx` — unrelated
| `dxf-reader.ts` — unrelated

---

## 6. Testing Checklist

1. **Mode A unchanged:** Pack a set of small parts → Mode A → verify offsetX = offsetY = 35, alignment = "margin"
2. **Mode B centered (high util):** Pack parts that fill ≥70% of sheet → verify centering, alignment = "centered"
3. **Mode B bottom-left (low util):** Pack 1–2 small parts → Mode B → verify offsetX = offsetY = 35, alignment = "bottom-left"
4. **Mode B clamped edge case:** Pack a single wide part (e.g. 1220mm wide) → Mode B, low util → verify offsetX = Math.min(35, 15) = 15, parts don't exceed sheet boundary
5. **Preview canvas:** Verify guide rectangle, label position, and CUT lines render correctly for all three alignment modes
6. **DXF export:** Export a bottom-left sheet and a centered sheet → open in AutoCAD/LibreCAD → verify parts are at correct positions, no out-of-bounds geometry
7. **Deduplication:** Verify CUT lines deduplicate correctly for bottom-left-aligned sheets (the offsets feed into `computeInsertPosition`, so this is implicitly tested)
8. **Sheet list badge:** Verify badge shows "Margin", "Centered", or "Bottom-Left" as appropriate
9. **Export dialog:** Verify mode description updates to reflect alignment

---

## 7. Rollback Plan

If issues arise, the change is trivially reversible:
- Remove `BOTTOM_LEFT_THRESHOLD` from `constants.ts`
- Remove `alignment` field from `SheetLayout` type
- Revert `packer.ts` offset block to the original centering logic
- Revert UI changes in `sheet-list.tsx`, `export-dialog.tsx`, `preview-canvas.tsx`

All other files are untouched, so rollback is clean.