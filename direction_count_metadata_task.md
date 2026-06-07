# Direction & Count Metadata — Source-of-Truth Unification

## Problem

When sheet-metal designs are imported into the nesting feature, the **required count** (how many copies to pack) and **direction** (arrow orientation, which locks rotation) are frequently lost — the nesting part always shows count=1 and free rotation regardless of what the designer set.

### Root Cause

Count and direction exist in **two disconnected systems**:

1. **Filename suffix convention** — Exported DXFs are named like `7-8_T_x10.dxf`, which the nesting filename parser (`parseFilename`) decodes perfectly. But this suffix is only appended during export, gated by the `includeMetadata` toggle being ON.

2. **Hidden model fields** — `model.metadataCount` and `model.arrowDirection` are stored in the Convex `designs` table. When importing from project, `createNestPartFromDesign()` reads these — but only when `includeMetadata` is `true`. The default is `false`, so for most designs the count is ignored and always resolves to 1.

The `includeMetadata` toggle was designed to control whether the **export filename** gets a suffix, but it accidentally became the gate for whether nesting respects the count/direction at all. Since `includeMetadata` defaults to `false`, the metadata is invisible to nesting for the majority of designs.

### Why This Matters

- **Count is a hard constraint** — if a design needs 7 copies and nesting packs 1, the output is wrong
- **Direction is informational for nesting** — the arrow is for the CNC operator; nesting should rotate freely for optimization
- **AutoCAD round-trips** — users export DXFs, edit them in AutoCAD, save with the same filename, then drag them back. The filename convention (`name_T_x10.dxf`) already carries the truth, but it's only reliable on the drag-and-drop path, not the project import path
- **Existing projects** have count baked directly into the design name (e.g., `7-8_x10`), but the system doesn't read it from there

---

## Solution: Filename-as-Source-of-Truth

Make the **`exportName` (and `name`) the canonical carrier** of count and direction metadata via the established filename suffix convention:

```
<basename>_<DIR>_x<count>    e.g. 7-8_T_x10
<basename>_x<count>          e.g. 7-8_x10  (no direction set)
<basename>_<DIR>             e.g. 7-8_R     (count defaults to 1)
<basename>                   e.g. 7-8      (direction defaults to none/free, count defaults to 1)
```

The four patterns above are exactly what `parseFilename()` in `alugamma/src/features/nesting/types.ts` already handles. No new parsing logic needed.

### Key Principle

- `exportName` (and `name`) **always** reflect the current count and direction via their suffix
- `model.metadataCount` and `model.arrowDirection` are **derived/synced** from the name, not an independent source
- `parseFilename(exportName)` is used by nesting to extract count and direction — same function for both drag-and-drop DXF import and project import
- `includeMetadata` toggle is removed — the metadata is always in the name, period

### Backwards Compatibility

- Existing designs with `exportName = "7-8"` (no suffix) → `parseFilename` returns count=1, direction=T (default). This is the same behavior as today for designs without metadata.
- Existing designs where `model.metadataCount > 1` but the name lacks the suffix → fall back to the model field. This handles old designs that were saved with count set but `includeMetadata` off. On next save, the suffix gets baked into the name.
- Direction from old designs: if the name has no `_[DIR]` suffix but the model has `arrowDirection` set, the arrow still renders in the DXF correctly (since `model.arrowDirection` is used for rendering), but nesting treats direction as free rotation (null). This is the correct behavior — the arrow is visual metadata, not a packing constraint.

---

## Implementation Plan

### Step 1: Add Count Input + Direction Dropdown to Sheet-Metal Navbar

**File:** `alugamma/src/features/sheet-metal/context.tsx`

Add two new state-updater functions to the context:

- `setDesignCount(count: number)` — updates `model.metadataCount` AND rewrites the `_x{n}` suffix in `name` and `exportName`
- `setDesignDirection(direction: SideKey | null)` — updates `model.arrowDirection` AND rewrites the `_[DIR]` suffix in `name` and `exportName`. When direction is `null`, remove the `_[DIR]` portion.

These functions must:

1. Parse the **current** `designName` with `parseFilename()` to extract the current basename, direction, and count
2. Rebuild the name with the updated component
3. Update both `designName` state AND `model.metadataCount` / `model.arrowDirection`

**Name reconstruction logic** (shared helper, added to `context.tsx`):

```typescript
import { parseFilename } from "@/features/nesting/types";
import { SIDE_KEY_TO_DIR } from "@/features/sheet-metal/types";

function buildDesignName(basename: string, direction: SideKey | null, count: number): string {
  let name = basename;
  if (direction) {
    name += `_${SIDE_KEY_TO_DIR[direction]}`;
  }
  if (count > 1) {
    name += `_x${count}`;
  }
  return name;
}

function parseDesignName(name: string): { basename: string; direction: SideKey | null; count: number } {
  const parsed = parseFilename(name + ".dxf"); // add fake extension so parser works
  // map parsed direction back to SideKey
  const dirMap: Record<string, SideKey> = { T: "top", B: "bottom", L: "left", R: "right" };
  return {
    basename: parsed.name,
    direction: parsed.direction ? dirMap[parsed.direction] ?? null : null,
    count: parsed.count,
  };
}
```

The `setDesignCount` implementation:

```typescript
function setDesignCount(count: number) {
  const clamped = Math.max(1, Math.round(count));
  const { basename, direction } = parseDesignName(designName);
  const newName = buildDesignName(basename, direction, clamped);
  setDesignName(newName);
  setModel((current) => ({ ...current, metadataCount: clamped }));
}
```

The `setDesignDirection` implementation:

```typescript
function setDesignDirection(direction: SideKey | null) {
  const { basename, count } = parseDesignName(designName);
  const newName = buildDesignName(basename, direction, count);
  setDesignName(newName);
  setModel((current) => ({
    ...current,
    arrowDirection: direction ?? "top", // model field needs a valid SideKey for arrow rendering
    includeArrow: direction !== null ? true : current.includeArrow,
  }));
}
```

**Important:** When direction is set to `null` (free rotation), the `model.arrowDirection` should still have a valid value (default "top") for arrow rendering, but `model.includeArrow` should be toggled off so no arrow is drawn. Alternatively, keep `includeArrow` separate and let the user control it independently — but the `_DIR_` suffix is only appended when a direction is explicitly chosen. Discuss with user if `includeArrow` should stay independent.

Add these two functions to the `SheetMetalContextType` and the provider's return value.

**File:** `alugamma/src/features/sheet-metal/types.ts`

Export the `SIDE_KEY_TO_DIR` map (already exported) and add a reverse map:

```typescript
export const DIR_TO_SIDE_KEY: Record<string, SideKey> = {
  T: "top",
  B: "bottom",
  L: "left",
  R: "right",
};
```

### Step 2: Update the Sheet-Metal Navbar/Toolbar UI

**File:** The sheet-metal toolbar/header component (where the design name input currently lives — find it by searching for where `designName` and `setDesignName` are used in the sheet-metal UI).

Add two controls alongside the existing name input:

1. **Count input** — small number input, min=1, showing the current count. On change → calls `setDesignCount()`.
2. **Direction dropdown** — 5 options: None (free), ↑ Top, → Right, ↓ Bottom, ← Left. On change → calls `setDesignDirection()`.

Derive the current values from the design name using `parseDesignName(designName)`:

```typescript
const { basename, direction, count } = parseDesignName(designName);
```

**When direction is "None" (null):** No `_[DIR]` suffix in the name. The arrow is not drawn. Nesting treats the part as freely rotatable.

**When direction is set:** The `_[DIR]` suffix appears in the name. The arrow is drawn pointing in that direction. Nesting STILL treats the part as freely rotatable (direction is visual metadata, see Step 5).

**When the user edits the name input directly** (typing in the text field): The name is set as-is via `setDesignName()`. Then the count/direction inputs should re-derive from the new name using `parseDesignName()`. If the user types `7-8_B_x5`, the count input auto-fills 5 and direction auto-selects Bottom. If they type just `7-8`, count defaults to 1 and direction to None.

### Step 3: Update Export Function — Remove `includeMetadata` Gate

**File:** `alugamma/src/features/sheet-metal/context.tsx` — the `exportDxf()` function

Currently:

```typescript
let filename = sanitizeFileName(designName);
if (model.includeMetadata) {
  const dir = SIDE_KEY_TO_DIR[model.arrowDirection] ?? "T";
  const count = model.metadataCount || 1;
  filename = `${filename}_${dir}_x${count}`;
}
```

After: The `designName` already contains the suffix. No conditional needed:

```typescript
const filename = sanitizeFileName(designName);
// The name already encodes direction and count, e.g. "7-8_T_x10"
```

The `includeMetadata` toggle in the export settings becomes unnecessary. It can be removed from the settings dialog and the model type entirely (or kept as a cosmetic setting but with no functional effect).

### Step 4: Remove `includeMetadata` from Settings Dialog

**File:** `alugamma/src/features/sheet-metal/export-settings-dialog.tsx`

Remove the "Include sheet part metadata" checkbox section and the `metadataCount` input (it's now in the navbar). The direction T/B/L/R buttons can also move out of this dialog (they're in the navbar dropdown now).

Keep the remaining settings: include name, include arrow, rubberband, and project defaults tab.

**File:** `alugamma/src/features/sheet-metal/types.ts`

- Remove `includeMetadata` from `SheetMetalModel` type (or deprecate it — keep the field for backwards compat when reading old models, but stop writing it)
- In `normalizeSheetMetalModel()`: keep reading `includeMetadata` for normalization of old models, but no longer write it

**File:** `alugamma/convex/validators.ts`

- Remove `includeMetadata` and `metadataCount` from `sheetModelValidator` (they're now derived from the name, not independent fields). Or keep them as optional fields that get synced from the name on save — see Step 6.

### Step 5: Update Nesting Import — Parse `exportName` for Count and Direction

**File:** `alugamma/src/features/nesting/dxf-reader.ts` — `createNestPartFromDesign()`

Currently (after our earlier fix):

```typescript
const direction: PartDirection = overrides?.direction ?? null;
const count = overrides?.count ?? (design.model.metadataCount || 1);
```

After: Parse the export name to get count and direction:

```typescript
import { parseFilename } from "./types";

// Parse direction and count from the export name (source of truth)
const parsed = parseFilename(design.exportName + ".dxf");
const direction: PartDirection = overrides?.direction ?? parsed.direction;
const count = overrides?.count ?? parsed.count;
```

**Direction handling for nesting:** Per the user's explicit requirement, direction should NOT lock rotation when importing from sheet-metal — the arrow is visual metadata for the CNC operator, not a packing constraint. So the direction from the filename should be stored on the NestPart for display/reference, but `rotationLocked` should remain `false` and `allowedRotation` should be `-1` (free rotation).

To achieve this, we need to store the direction on the NestPart (for the UI badge) but force the rotation to be unlocked. Add a check in `createNestPart` or after creating the part:

Option A: Always override `allowedRotation` for sheet-metal source parts:

```typescript
const part = createNestPartFromGeometry(
  design.exportName,
  direction,  // stored for display
  count,
  l0Width,
  l0Height,
  cutLines,
  design.id,
  dxfContent,
);

// Sheet-metal parts: arrow direction is visual metadata, not a packing constraint
if (part.source === "sheet-metal") {
  part.rotationLocked = false;
  part.allowedRotation = -1;
}
```

Option B: Create the part with `direction: null` but store the parsed direction in a separate display-only field. This is cleaner but requires adding a field to `NestPart`.

**Recommended: Option A** — simpler, no schema change. The `direction` field on `NestPart` keeps its value (so the UI badge shows ↑T or →R), but `rotationLocked` and `allowedRotation` are forced to unlocked for sheet-metal parts. The packer only reads `allowedRotation`, not `direction`, so this works correctly.

### Step 6: Sync Model Fields on Save

**File:** `alugamma/src/features/sheet-metal/context.tsx` — the `saveDesign()` function

When saving a design, derive `metadataCount` and `arrowDirection` from the current `designName` so the model fields stay in sync:

```typescript
async function saveDesign(options?: { markExported?: boolean }) {
  // ...
  const normalizedModel = normalizeSheetMetalModel(model);

  // Sync metadata fields from the design name (source of truth)
  const parsed = parseDesignName(designName);
  normalizedModel.metadataCount = parsed.count;
  if (parsed.direction) {
    normalizedModel.arrowDirection = parsed.direction;
  }

  await saveDesignMutation({
    // ...
    model: normalizedModel,
    // ...
  });
}
```

This ensures that existing code that reads `model.metadataCount` or `model.arrowDirection` (e.g., the nesting dialog badges) still works with the correct values.

### Step 7: Update Nesting Project Import Dialog

**File:** `alugamma/src/features/nesting/part-list.tsx`

The dialog badges currently derive direction and count from model fields:

```typescript
const dir = { top: "↑T", right: "→R", bottom: "↓B", left: "←L" }[m.arrowDirection];
const count = m.metadataCount || 1;
```

After: Parse from `design.exportName` instead (which is the source of truth):

```typescript
import { parseFilename } from "./types";

// Parse direction and count from the export name
const parsed = parseFilename(design.exportName + ".dxf");
const dirMap: Record<string, string> = { T: "↑T", B: "↓B", L: "←L", R: "→R" };
const dir = parsed.direction ? dirMap[parsed.direction] : null;
const count = parsed.count;
```

This is consistent with how drag-and-drop import works and with the new `createNestPartFromDesign` logic.

### Step 8: Handle Backwards Compatibility for Old Designs

**In `createNestPartFromDesign()`:**

When parsing `exportName` returns count=1 and direction=T (defaults from `parseFilename` for names without suffixes), check if the model fields have higher values as a fallback for old designs:

```typescript
const parsed = parseFilename(design.exportName + ".dxf");

// Backwards compatibility: if the export name has no suffix (old design format),
// fall back to model fields if they have non-default values
let count = parsed.count;
if (count === 1 && (design.model.metadataCount || 0) > 1) {
  count = design.model.metadataCount;
}

const direction: PartDirection = overrides?.direction ?? parsed.direction;
```

Direction fallback is less critical since nesting always treats sheet-metal parts as freely rotatable, but the same pattern could apply for the UI display:

```typescript
let direction: PartDirection = parsed.direction;
if (!direction && design.model.arrowDirection && design.model.includeMetadata) {
  // Old design that had direction set via includeMetadata
  direction = SIDE_KEY_TO_DIR[design.model.arrowDirection] as PartDirection;
}
```

This fallback ensures old designs with `metadataCount=7` but `exportName="7-8"` still get count=7 instead of 1. Once they're re-saved, the suffix gets baked into the name and the fallback is no longer needed.

---

## File Change Summary

| File | Changes |
|------|---------|
| `alugamma/src/features/sheet-metal/context.tsx` | Add `setDesignCount()`, `setDesignDirection()`, `parseDesignName()`, `buildDesignName()` helpers. Update `exportDxf()` to remove `includeMetadata` gate. Update `saveDesign()` to sync model fields from name. |
| `alugamma/src/features/sheet-metal/types.ts` | Add `DIR_TO_SIDE_KEY` reverse map. Deprecate `includeMetadata` field (keep reading for old models, stop writing). |
| `alugamma/src/features/sheet-metal/export-settings-dialog.tsx` | Remove "Include sheet part metadata" section (count + direction now in navbar). Move direction controls out of this dialog. |
| Sheet-metal navbar/header component | Add count input + direction dropdown next to name input. Derive values from `parseDesignName(designName)`. |
| `alugamma/src/features/nesting/dxf-reader.ts` | Update `createNestPartFromDesign()` to parse count/direction from `design.exportName` via `parseFilename`. Force `rotationLocked=false` and `allowedRotation=-1` for sheet-metal parts. Add backwards-compat fallback from model fields. |
| `alugamma/src/features/nesting/part-list.tsx` | Update project import dialog to derive count/direction from `design.exportName` via `parseFilename`. |
| `alugamma/convex/validators.ts` | Deprecate or remove `includeMetadata` and `metadataCount` from `sheetModelValidator` (these are now derived from the name). |
| `NESTING_EXPLAINED_v1.md` | Update documentation to reflect the new source-of-truth system. |

---

## Migration Path for Existing Data

Existing Convex designs have:
- `exportName`: e.g., `"7-8"` (no suffix) or `"7-8_T_x10"` (already has suffix from a metadata-enabled export)
- `model.metadataCount`: e.g., `7` (might differ from what's in the name)
- `model.includeMetadata`: `true` or `false`

**No migration script needed.** The backwards-compat fallback in Step 8 handles this:
- If `exportName` has no `_x{n}` suffix → fall back to `model.metadataCount`
- If `exportName` has no `_[DIR]` suffix but `model.arrowDirection` is set and `includeMetadata` was on → fall back to model direction
- On next edit+save → `saveDesign()` syncs the name suffix from model fields, baking the metadata into the name permanently

Over time, all designs will naturally get the suffix in their name, and the fallback code becomes unused. It can be removed in a future cleanup.

---

## Testing Checklist

- [ ] Create new design, set name to `7-8`, set count to 10, set direction to Right → name becomes `7-8_R_x10`
- [ ] Export DXF → filename is `7-8_R_x10.dxf`
- [ ] Drag that DXF back into nesting → part shows count=10, direction=R badge, but rotation is unlocked (free)
- [ ] Import same design via "Import from project" → same result
- [ ] Change count via the nesting count input → part count updates
- [ ] Create design with no direction set → name is `7-8_x5`, nesting rotates freely
- [ ] Create design with count=1 → name is `7-8` (no `_x1` suffix for clean names)
- [ ] Load an OLD design with `exportName="7-8"`, `model.metadataCount=7` → nesting import shows count=7 (fallback works)
- [ ] Edit and save that old design → name becomes `7-8_x7`, `model.metadataCount=7` synced
- [ ] Type `panel_B_x3` directly in name input → count auto-fills 3, direction auto-selects Bottom
- [ ] Clear the name to just `panel` → count resets to 1, direction resets to None