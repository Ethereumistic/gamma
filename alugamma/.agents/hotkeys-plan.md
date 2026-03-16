# Hotkeys Feature Plan — AluGamma DXF Workspace

## Overview

Add a global **Settings dialog** accessible from the sidebar footer, starting with a **Keyboard Shortcuts** panel. Hotkeys are implemented using `@tanstack/react-hotkeys` and are active only when the user is on the Sheet Metal editor route (`/sheet-metal/*`). A secondary concern is "side selection" state that enables a second layer of context-aware hotkeys.

---

## 1. Installation

```bash
pnpm add @tanstack/react-hotkeys
# install devtools for the debug overlay during development:
pnpm add -D @tanstack/react-devtools
pnpm add -D @tanstack/react-hotkeys-devtools
```
>Note: All dependencies are ALREADY installed proceed to the next step.
+ @tanstack/react-hotkeys 0.4.1
+ @tanstack/react-devtools 0.10.0
+ @tanstack/react-hotkeys-devtools 0.4.1
---

## 2. Files to Create

| File | Purpose |
|------|---------|
| `src/features/settings/settings-dialog.tsx` | The Settings dialog shell (tabbed: Hotkeys, …future tabs) |
| `src/features/settings/hotkeys-panel.tsx` | Hotkeys reference table shown inside the dialog |
| `src/features/settings/context.tsx` | Settings context — holds `settingsOpen` boolean and `openSettings()` |
| `src/features/sheet-metal/hotkeys.tsx` | All hotkey bindings for the sheet-metal editor |
| `src/features/sheet-metal/selected-side-context.tsx` | Global atom/context for which side (top/right/bottom/left/none) is currently "selected" |

---

## 3. Settings Context (`src/features/settings/context.tsx`)

Minimal context that lets any component open the Settings dialog:

```tsx
type SettingsContextValue = {
  settingsOpen: boolean;
  openSettings: (tab?: "hotkeys") => void;
  closeSettings: () => void;
};
```

Wrap this provider high in the tree — inside `App.tsx` / root layout, alongside `SheetMetalProvider` and `WorkspaceProvider`.

---

## 4. Sidebar Footer Change (`app-sidebar.tsx`)

Inside `<SidebarFooter>`, in the authenticated+viewer branch, add a **Settings icon button** to the right of the user info card.

Current structure:
```
[UserRound icon | Name / Email]
[Sign out button — full width]
```

Target structure:
```
[UserRound icon | Name / Email]  [Settings ⚙ icon button]
[Sign out button — full width]
```

**Implementation:**
- Change the user info card's container from a plain div to `flex items-center gap-2` (the card takes `flex-1`, the settings button is `shrink-0`).
- Import `Settings` from `lucide-react`.
- The button calls `openSettings("hotkeys")` from `useSettings()`.
- Style: `variant="ghost"` size `"icon"`, `h-8 w-8`, same muted hover style as other sidebar controls.

```tsx
import { Settings } from "lucide-react";
// …
const { openSettings } = useSettings();

// Inside SidebarFooter authenticated block:
<div className="flex items-center gap-2">
  <div className="flex-1 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
    {/* existing user info content unchanged */}
  </div>
  <Button
    variant="ghost"
    size="icon"
    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-white"
    onClick={() => openSettings("hotkeys")}
    title="Settings"
  >
    <Settings className="h-4 w-4" />
  </Button>
</div>
```

---

## 5. Settings Dialog (`src/features/settings/settings-dialog.tsx`)

- Uses shadcn `Dialog` / `DialogContent`.
- Has a left tab list: **Keyboard Shortcuts** (only tab for now, more later).
- Renders `<HotkeysPanel />` as the active tab content.
- Controlled by `SettingsContext` (`settingsOpen` / `closeSettings`).

```tsx
<Dialog open={settingsOpen} onOpenChange={(o) => !o && closeSettings()}>
  <DialogContent className="max-w-2xl border-white/10 bg-[#090d16] text-white">
    <DialogHeader>
      <DialogTitle>Settings</DialogTitle>
    </DialogHeader>
    <div className="flex gap-6 pt-2">
      {/* Left tab nav */}
      <nav className="w-36 shrink-0 …">
        <button className="…">Keyboard Shortcuts</button>
      </nav>
      {/* Tab content */}
      <div className="flex-1">
        <HotkeysPanel />
      </div>
    </div>
  </DialogContent>
</Dialog>
```

---

## 6. Hotkeys Panel (`src/features/settings/hotkeys-panel.tsx`)

A read-only reference table grouped into two sections:

### Section A — Traditional
| Shortcut | Action |
|----------|--------|
| `Mod+S` | Save design |
| `Mod+S` → `D` *(sequence)* | Save + Duplicate |
| `Mod+S` → `E` *(sequence)* | Save + Export DXF |
| `Mod+N` | New design |
| `Mod+Delete` | Delete design (confirm dialog) |
| `Mod+Shift+Delete` | Delete design (bypass dialog) |
| `Mod+F` | Center/focus the DXF preview |
| `Mod+R` | Toggle rubberband effect |

### Section B — Power User (Sheet Metal editor only)
| Shortcut | Action |
|----------|--------|
| `W` | Select Top side card |
| `A` | Select Left side |
| `S` | Select Bottom side |
| `D` | Select Right side |
| `F` *(side selected)* | Add Flange to selected side + focus input |
| `Z` *(side selected)* | Add Frez to selected side + focus input |
| `Q` *(side selected)* | Toggle L checkbox on selected side |
| `E` *(side selected)* | Toggle R checkbox on selected side |

Use `<kbd>` tags styled with a monospace bordered chip look to render each key.

---

## 7. Selected Side Context (`src/features/sheet-metal/selected-side-context.tsx`)

The power-user hotkeys (W/A/S/D and the subsequent F/Z/Q/E) require knowing which side is "active". This needs to be global state (not local to a single component) because:
- `W/A/S/D` are registered globally.
- `F/Z/Q/E` then act on the selected side by calling `addFlange(side)` etc. from `useSheetMetal()`.

```tsx
type SelectedSideContextValue = {
  selectedSide: SideKey | null;
  setSelectedSide: (side: SideKey | null) => void;
};
```

Visual feedback: when a side is selected, give the corresponding `SideEditorForSide` panel a visible ring (e.g. `ring-1 ring-emerald-500/40`). Pass `isSelected` prop into `SideEditorForSide` and conditionally add the ring class.

---

## 8. Hotkey Bindings (`src/features/sheet-metal/hotkeys.tsx`)

Create a `<SheetMetalHotkeys />` component that is rendered **inside** `SheetMetalApp` (so it only mounts on sheet-metal routes). It reads from `useSheetMetal()`, `useWorkspace()`, `useNavigate()`, and `useSelectedSide()`.

### TanStack Hotkeys API pattern

```tsx
import { useHotkeys } from "@tanstack/react-hotkeys";

useHotkeys([
  {
    keys: "mod+s",
    handler: () => { /* save */ },
  },
  {
    // Sequence: Mod+S then D within 1000ms
    keys: "mod+s>d",
    handler: () => { /* save + duplicate */ },
  },
]);
```

> **Verify the exact sequence syntax** against https://tanstack.com/hotkeys/latest/docs/overview before implementing. TanStack Hotkeys uses `>` or `,` between keys for sequences (vim-style). The window is typically configurable (default ~1000ms).

### Full binding list

```
mod+s               → handleSave()
mod+s>d             → handleSave() then duplicateDesign(selectedDesignId) then navigate
mod+s>e             → handleExport() (which is save + export DXF)
mod+n               → startNewDesign() + navigate("/sheet-metal/new")
mod+delete          → setDesignToDelete(selectedDesignId)  [opens confirm dialog]
mod+shift+delete    → deleteDesign({ designId: selectedDesignId }) directly, then navigate("/sheet-metal/new")
mod+f               → centerView() [see note below]
mod+r               → setRubberband(!model.rubberband)

w                   → setSelectedSide("top")
a                   → setSelectedSide("left")
s                   → setSelectedSide("bottom")
d                   → setSelectedSide("right")

f  [side selected]  → addFlange(selectedSide) + focus last flange input (see §9)
z  [side selected]  → addFrez(selectedSide) + focus last frez input
q  [side selected]  → toggleFlangeRelief(selectedSide, "start")  — toggle the L checkbox of the last flange on selected side
e  [side selected]  → toggleFlangeRelief(selectedSide, "end")    — toggle the R checkbox of the last flange on selected side
```

**Conflict guard for `s` vs `mod+s`:** The bare `s` (select bottom) must NOT fire when the user is typing in an input/textarea. Use the `enabled` option or `ignoreInputFields: true` on the bare letter hotkeys. This is critical — without it `s` will fire while the user types in the design name field.

```tsx
useHotkeys([
  { keys: "w", handler: () => setSelectedSide("top"), options: { ignoreInputFields: true } },
  { keys: "a", handler: () => setSelectedSide("left"), options: { ignoreInputFields: true } },
  { keys: "s", handler: () => setSelectedSide("bottom"), options: { ignoreInputFields: true } },
  { keys: "d", handler: () => setSelectedSide("right"), options: { ignoreInputFields: true } },
]);
```

**Conflict guard for `f/z/q/e`:** Same — only fire when `selectedSide !== null` AND not in an input field.

```tsx
const isSideSelected = selectedSide !== null;

useHotkeys([
  {
    keys: "f",
    enabled: isSideSelected,
    handler: () => { addFlange(selectedSide!); focusLastFlangeInput(selectedSide!); },
    options: { ignoreInputFields: true },
  },
  // … z, q, e
]);
```

### `mod+f` — Center View

`PreviewCanvas` currently does not expose a center/reset function. You need to:
1. Add a `centerView` imperative handle to `PreviewCanvas` via `useImperativeHandle` + `forwardRef`, OR
2. Add a `centerView` callback to `useSheetMetal()` context that triggers a state reset for pan/zoom.

Choose whichever approach matches how `PreviewCanvas` currently manages its viewport state.

---

## 9. Focusing Inputs After Add

When `F` adds a flange, the UX should automatically focus the new flange's numeric input. This requires refs on the inputs inside `FlangeChip` / `FlangeBlock`.

**Recommended approach:**
- In `SideEditor`, expose a `focusLastFlange()` and `focusLastFrez()` method via `useImperativeHandle` on a forwarded ref.
- In `SheetMetalHotkeys`, hold refs to each of the four `SideEditorForSide` instances and call `sideRef[selectedSide].current?.focusLastFlange()` after `addFlange`.
- This requires passing a `ref` prop down through `SideEditorForSide` to the underlying `SideEditor`.

Alternative (simpler): after `addFlange`, use a `setTimeout(0)` to query the DOM for the last input inside the relevant side panel by a `data-side` attribute and call `.focus()` on it.

---

## 10. Delete Confirm Dialog State

`designToDelete` state currently lives inside `AppSidebar`. The `mod+delete` hotkey fires from `SheetMetalHotkeys` which is inside `SheetMetalApp` — a different subtree.

**Solution:** Lift `designToDelete` state (and the `AlertDialog`) out of `AppSidebar` into a shared context, or into `SheetMetalContext`. Expose `triggerDeleteDialog(designId)` from that context. Both the sidebar dropdown and the hotkey can call this.

The `mod+shift+delete` (bypass dialog) path calls `deleteDesign` directly — no dialog needed.

---

## 11. Integration Points Summary

| What changes | File | Change type |
|---|---|---|
| Add `SettingsProvider` | `App.tsx` or root layout | Wrap |
| Add `SelectedSideProvider` | `App.tsx` or root layout | Wrap |
| Add `<SettingsDialog />` | Root layout | Mount once |
| Add Settings ⚙ button | `app-sidebar.tsx` | UI addition |
| Add `<SheetMetalHotkeys />` | `sheet-metal.tsx` | Mount inside editor |
| Add `isSelected` prop + ring | `sheet-metal.tsx` → `SideEditorForSide` | Prop + conditional class |
| Lift `designToDelete` | `app-sidebar.tsx` + new context | Refactor |
| Expose `centerView` | `preview-canvas.tsx` | Ref/callback |
| Expose `focusLast*` | `side-editor.tsx` | Ref handle |

---

## 12. Order of Implementation

1. Install `@tanstack/react-hotkeys`.
2. Create `SelectedSideContext` — no UI yet, just the state.
3. Create `SettingsContext` + `SettingsDialog` + `HotkeysPanel` (reference table only).
4. Add ⚙ button to sidebar footer.
5. Lift `designToDelete` into a shared context.
6. Implement `SheetMetalHotkeys` — start with `mod+s`, `mod+n`, `mod+delete` (confirm), `mod+shift+delete`.
7. Add `w/a/s/d` side selection + visual ring feedback.
8. Add `f/z` add-and-focus (with input focus refs).
9. Add `q/e` checkbox toggles.
10. Add `mod+s>d` and `mod+s>e` sequences.
11. Add `mod+f` center view (requires `PreviewCanvas` ref work).
12. Add `mod+r` rubberband toggle.
13. Test all hotkeys don't fire inside input fields.

---

## 13. Key Constraints & Gotchas

- **`s` key conflict:** `S` = select bottom side, but `Mod+S` = save. TanStack Hotkeys treats these as distinct bindings. Just ensure `ignoreInputFields: true` on bare letters.
- **Sequence timeout:** `mod+s>d` and `mod+s>e` need to complete within the library's sequence window (typically 1000ms). Make sure this is configurable or at least documented to users.
- **`mod+f` vs `f`:** `mod+f` = center view (global), bare `f` = add flange (only when side selected, not in input). No conflict.
- **`e` key:** bare `e` = toggle R checkbox (side selected, not in input). `mod+s>e` = export. These are distinct; no conflict.
- **Escape key:** consider binding `Escape` to `setSelectedSide(null)` to deselect a side.
- **Dialog open guard:** when any dialog (Settings, Delete confirm) is open, the bare-letter hotkeys (`w/a/s/d/f/z/q/e`) should not fire. Use the `enabled` option or check dialog state in handlers.