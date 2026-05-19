# CNC Pipeline Navbar Sequence Refactor Plan

## Goal

Refactor the CNC pipeline's app navbar "Sequence" section and Settings dialog across both `CNCPipelinePage.tsx` and `$programId.tsx` to be more compact, use pill-based layer+tool items with hover-to-remove X buttons, consolidate the "add layer" UI into a single dropdown, remove the "custom" tag, and change the Settings button to icon-only.

---

## Files to Modify

| File | Purpose |
|---|---|
| `alugamma/src/features/cnc-pipeline/CNCPipelinePage.tsx` | Initial DXF upload/preview page — has its own navbar portal with sequence UI |
| `alugamma/src/routes/cnc-pipeline/$programId.tsx` | Saved NC program viewer page — has its own navbar portal with sequence UI |
| `alugamma/src/features/cnc-pipeline/components/SequencePill.tsx` | **NEW** — Shared pill component for sequence items |
| `alugamma/src/features/cnc-pipeline/components/AddLayerDropdown.tsx` | **NEW** — Shared dropdown component for adding layers |

> **Critical**: Both page files have near-identical sequence navbar rendering code. The refactor must keep them in sync. The new shared components (`SequencePill`, `AddLayerDropdown`) will prevent drift.

---

## Shared Data Structures (existing, do NOT change)

- `layerSequence: [string, string][]` (`IdSequence` type from `types.ts`) — in `CNCPipelinePage.tsx`, each entry is `[layerName, toolId]` where toolId is the string id like `"prav"`.
- `layerSequence: [string, number][]` (`CustomSequence` type from `types.ts`) — in `$programId.tsx`, each entry is `[layerName, toolNumber]` where toolNumber is the pocket number like `7`.

> **Important note**: The two pages use slightly different sequence formats. `$programId.tsx` uses `[layer, toolNumber]` (number) because it stores to Convex as `CustomSequence`. `CNCPipelinePage.tsx` uses `[layer, toolId]` (string id) because it sends to the Python backend as `IdSequence`. The shared components must accept a generic render callback and NOT assume the second element's type. Both pages will map their sequence entries to display props before passing to the shared components.

---

## 1. Sequence Pills (replace current inline rendering)

### Current (both files)

Each layer in the sequence is rendered as a loose group of:
- A `→` arrow separator
- A Select dropdown for position reorder (clicking the layer name)
- A `T{n}` tool selector dropdown
- A static `"custom"` text tag when sequence differs from default

These are separated by arrows and take significant horizontal space.

### New — `SequencePill` component

Create `alugamma/src/features/cnc-pipeline/components/SequencePill.tsx`:

```tsx
interface SequencePillProps {
  /** Display name of the layer (e.g. "CUT", "CUSTOM1") */
  layer: string
  /** CSS color for the layer pill accent */
  color: string
  /** Tool display string (e.g. "T7") */
  toolLabel: string
  /** Whether the pill is in a disabled state (e.g. during regeneration) */
  disabled?: boolean
  /** Called when the X remove button is clicked */
  onRemove: () => void
  /** Called when the pill body is clicked (opens reorder or tool selector) */
  onReorder?: (newIndex: number) => void
  /** Total number of pills in sequence (for reorder dropdown) */
  totalCount?: number
  /** Current index of this pill in the sequence */
  currentIndex?: number
}
```

**Visual spec**:
- Pill shape: `rounded-full` with a **left color accent bar** (2px wide, 6px rounded-left-only, matching the layer color).
- Background: `bg-white/[0.06]` with `border border-white/10`.
- Content inside: layer name (bold, uppercase, 10px, in layer color) + `T{n}` tool label (9px mono, slate-500).
- On **hover**: subtle `bg-white/10` and an **X button** fades in at the right side of the pill (absolute positioned, `opacity-0 group-hover:opacity-100`).
- The X button is `h-4 w-4`, uses `<X>` icon from lucide, colored `text-slate-400 hover:text-red-400`.
- If `onReorder` is provided, clicking the layer name text shows a tiny dropdown to change position.
- Pills are separated by `→` arrows (same as current, `text-slate-600 mx-0.5`).

**Key requirement**: The pill must NOT show any "custom" or "modified" badge. The "custom" indicator is removed entirely.

### Replace current inline code

In both `$programId.tsx` and `CNCPipelinePage.tsx`, find the inline `layerSequence.map(...)` block that currently renders position Select + tool Select + arrow separators, and replace it with:

```tsx
{layerSequence.map(([layer, toolId], idx) => (
  <SequencePill
    key={layer}
    layer={layer}
    color={getLayerColor(layer)}
    toolLabel={/* "T7" for $programId, "T" + resolvedTools[toolId].number for CNCPipelinePage */}
    onRemove={() => handleRemoveLayerFromSequence(idx)}
    onReorder={(newIdx) => { /* splice-move logic, same as current */ }}
    currentIndex={idx}
    totalCount={layerSequence.length}
    disabled={isRegenerating}
  />
))}
```

Remove the `{isCustomOrder && <span ...>custom</span>}` element entirely from both files.

---

## 2. Add-Layer Dropdown (replace per-layer + buttons)

### Current (CNCPipelinePage.tsx)

Unassigned detected layers appear as individual `<button>` elements with Plus icons next to the sequence, one per layer. This takes horizontal space and doesn't scale.

### Current ($programId.tsx)

No add-layer UI in the navbar — only available in the Settings dialog.

### New — `AddLayerDropdown` component

Create `alugamma/src/features/cnc-pipeline/components/AddLayerDropdown.tsx`:

```tsx
interface AddLayerDropdownProps {
  /** Layers available to add (not yet in the sequence) */
  availableLayers: Array<{
    layer: string
    color: string
    /** Suggested tool label e.g. "T7" */
    toolLabel: string
  }>
  /** Called when user selects a layer to add */
  onAddLayer: (layer: string) => void
  /** Whether the dropdown is disabled (e.g. during generation) */
  disabled?: boolean
}
```

**Visual spec**:
- Single `+` button (circular, `h-6 w-6`, `bg-white/[0.06] border border-dashed border-white/20`) placed after the last sequence pill.
- On click: opens a Radix `Popover` (or `DropdownMenu`) with the available layers.
- Each menu item shows: a small color dot + layer name + tool label. Clicking adds the layer.
- If no layers are available, show the `+` button as disabled/muted with `opacity-30`.
- The `+` icon uses lucide `<Plus>`.

**Integration in `$programId.tsx`**: Compute `unassignedLayers` the same way `CNCPipelinePage.tsx` does — filter `program.contoursByLayer` keys that are not in the current `layerSequence`. Also include layers from `resolvedLayerToolMap` keys not yet in sequence. Then render `<AddLayerDropdown>` after the sequence pills.

**Integration in `CNCPipelinePage.tsx`** (already has `unassignedLayers`): Replace the current `{unassignedLayers.length > 0 && <div ...>}` block with `<AddLayerDropdown>`.

---

## 3. Settings Button — Icon Only

### Current

Both files render the Settings dialog trigger as:
```
<Button ... ><Settings2 className="h-3.5 w-3.5" />  Settings</Button>
```
or
```
<Button ... ><Settings2 className="h-3.5 w-3.5" /></Button>
```

### Change

In **both** files, ensure the Settings `DialogTrigger` button renders as **icon-only** (no text). The button should be:
```tsx
<Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-white/5">
  <Settings2 className="h-3.5 w-3.5" />
</Button>
```

Make sure there is NO text label like "Settings" inside the button. The icon is sufficient since it's in the navbar alongside other icon-only actions.

---

## 4. Remove "custom" Tag

Find and remove from both files:
- The `{isCustomOrder && (<span className="text-[9px] text-amber-400/70 ml-1 italic">custom</span>)}` element in the navbar sequence area.

Keep the `isCustomOrder` state variable and its computation — it's still needed internally to decide whether to send a custom sequence when regenerating/saving. Just remove the visual indicator from the UI.

---

## 5. Settings Dialog — Update to Match Pill Style (optional but recommended)

Inside the Settings Dialog (both files), the layer sequence list currently renders with:
- Number + color dot + layer name + tool selector + up/down arrows + (in CNCPipelinePage) remove button

Update the dialog inner list to also use pill-like items, but **keep the full interactive list** (tool selector, up/down, remove, unassigned add-buttons) because the dialog has more space. The dialog content should remain functionally identical — this is just a visual consistency pass. The `X` remove buttons in the dialog should always be visible (not hover-to-show), since space isn't constrained.

---

## 6. Detailed Item-by-Item Checklist

### `SequencePill.tsx` (NEW)
- [ ] Create `alugamma/src/features/cnc-pipeline/components/SequencePill.tsx`
- [ ] Props: `layer`, `color`, `toolLabel`, `disabled?`, `onRemove`, `onReorder?`, `currentIndex?`, `totalCount?`
- [ ] Render as a `group` relative container with `rounded-full` styling
- [ ] Left color accent bar (2px, layer color)
- [ ] Layer name text (bold, uppercase, 10px, layer color)
- [ ] Tool label (9px mono, slate-500)
- [ ] Hover-reveal X button (opacity-0 → group-hover:opacity-100, `X` icon from lucide)
- [ ] Clicking layer name area opens position reorder dropdown (if `onReorder` provided)
- [ ] Keyboard accessible (remove via Delete/Backspace key)

### `AddLayerDropdown.tsx` (NEW)
- [ ] Create `alugamma/src/features/cnc-pipeline/components/AddLayerDropdown.tsx`
- [ ] Props: `availableLayers`, `onAddLayer`, `disabled?`
- [ ] Single `+` circular button trigger
- [ ] Radix Popover/DropdownMenu content listing available layers
- [ ] Each item: color dot + layer name (uppercase bold) + tool label
- [ ] Click adds the layer, closes dropdown
- [ ] Disabled state when no layers available

### `$programId.tsx` changes
- [ ] Import `SequencePill` and `AddLayerDropdown`
- [ ] Import `X` from lucide-react (if not already)
- [ ] Compute `unassignedLayers` from `program.contoursByLayer` keys not in `layerSequence`
- [ ] Replace the inline `layerSequence.map(...)` with `<SequencePill>` components
- [ ] Remove the `{isCustomOrder && <span>custom</span>}` element
- [ ] Add `<AddLayerDropdown>` after the sequence pills
- [ ] Add `handleRemoveLayerFromSequence` handler that splices the layer out and regenerates (same pattern as `handleRegenerate(undefined, newSeq)`)
- [ ] Change Settings button to icon-only (remove any text)
- [ ] Keep the Settings dialog content as-is (it already has reorder + remove + unassigned layers)

### `CNCPipelinePage.tsx` changes
- [ ] Import `SequencePill` and `AddLayerDropdown`
- [ ] Replace the inline `layerSequence.map(...)` block with `<SequencePill>` components
- [ ] Remove the `{isCustomOrder && <span>custom</span>}` element
- [ ] Replace the `{unassignedLayers.length > 0 && <div>...per-layer buttons...</div>}` navbar block with `<AddLayerDropdown>`
- [ ] Change Settings button to icon-only (remove "Settings" text)
- [ ] Keep the Settings dialog content as-is visually (reorder + remove + unassigned buttons inside the dialog)

---

## 7. Visual Reference (ASCII)

### Current navbar sequence:
```
[CUT ▼] T7  →  [FREZ ▼] T9  →  [CUSTOM1 ▼] T7  +CUSTOM1  +HOLES  custom   ⚙ Settings
```

### After refactor:
```
▌CUT T7 ✕  →  ▌FREZ T9 ✕  →  ▌CUSTOM1 T7 ✕   ⊕   ⚙
                                       (hover→X)    
```

- Each `▌` is the colored accent left-border of the pill.
- `✕` appears only on hover (the X remove button).
- `⊕` is the single `+` dropdown to add unassigned layers.
- `⚙` is the icon-only Settings button.
- No "custom" tag anywhere.

---

## 8. Key Implementation Notes

1. **Do NOT change the sequence state structure or regeneration logic.** The `layerSequence`, `handleRegenerate`, `handleLayerSequenceChange`, and `handleSave` functions should remain identical in behavior. Only the rendering changes.

2. **Do NOT change backend code.** This is purely a frontend refactor.

3. **Do NOT change the `getLayerColor` function or `LAYER_COLORS`.** These were already updated in the prior fix.

4. **Both files must stay in sync.** After modifying one file, copy the same pattern to the other. Using the shared `SequencePill` and `AddLayerDropdown` components prevents drift.

5. **The `$programId.tsx` uses `CustomSequence` ([string, number][]) with tool numbers, while `CNCPipelinePage.tsx` uses `IdSequence` ([string, string][]) with tool IDs.** The shared component `SequencePill` only receives display props (`layer`, `color`, `toolLabel`) — it does NOT receive the raw sequence entry. Each page is responsible for mapping its own sequence format to display props.

6. **Removing a layer from the sequence must trigger a regeneration** (same as current behavior for reorder). In `$programId.tsx`, call `handleRegenerate(undefined, newSeq)` with the layer removed. In `CNCPipelinePage.tsx`, call `handleLayerSequenceChange(newSeq)`.

7. **The `+` dropdown for adding layers in `$programId.tsx`** currently does NOT exist in the navbar — it only exists inside the Settings dialog. After this refactor, add it to the navbar too. Compute available layers from `program.contoursByLayer` keys + `resolvedLayerToolMap` keys that aren't in `layerSequence`.

8. **Preserve existing imports**: `getLayerColor`, `Settings2`, `X`, `Plus`, `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` etc. The new components will need some of these; remove unused ones after refactoring.