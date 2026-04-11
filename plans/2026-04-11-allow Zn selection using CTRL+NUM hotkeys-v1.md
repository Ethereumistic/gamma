# Unified Feature Numbering: Allow Zn Selection via CTRL+NUM Hotkeys

## Objective

Currently, flanges (F) and inner FREZ lines (Z) are numbered independently per side — e.g. F1, F2, F3, Z1. The CTRL+1/2/3 hotkeys only jump to flange indices. The goal is to number all features sequentially in their visual order (e.g. F1, F2, Z3, F4) so that CTRL+N selects the Nth feature regardless of type, and the Z labels reflect their unified position.

## Current Behavior (the problem)

- Flanges and inner FREZ lines are stored in separate arrays: `sideConfig.flanges[]` and `sideConfig.innerFrezLines[]`
- Labels are rendered as `F{index+1}` and `Z{index+1}` using each array's own index
- CTRL+1..9 hotkeys (`hotkeys.tsx:134-148`) only iterate `sideConfig.flanges` — they cannot select inner FREZ lines
- Example: 3 flanges + 1 inner FREZ shows as F1, F2, F3, Z1 — CTRL+1/2/3 select F1/F2/F3, Z1 is unreachable via CTRL+NUM

## Target Behavior

- Features are numbered sequentially in their visual order: F1, F2, Z3, F4
- CTRL+N selects the Nth feature regardless of type (flange or inner FREZ)
- The Z label shows its unified position number (Z3, not Z1)
- Selection state correctly highlights the right chip/block

## Implementation Plan

- [ ] **Step 1. Create a unified feature ordering helper in `types.ts`**

  Add a helper function that computes the unified visual order of features on a side. Since flanges and innerFrezLines are rendered sequentially (all flanges first, then all inner FREZ lines — see `side-editor.tsx:497-521`), the unified order is simply: flanges in their array order, then inner FREZ lines in their array order.

  Add to `alugamma/src/features/sheet-metal/types.ts`:

  ```ts
  export type FeatureKind = "flange" | "innerFrez";

  export type FeatureRef = {
    kind: FeatureKind;
    /** Index into the respective array (flanges[] or innerFrezLines[]) */
    arrayIndex: number;
    /** 1-based unified position across all features on this side */
    position: number;
  };

  export function getUnifiedFeatures(side: SideConfig): FeatureRef[] {
    const features: FeatureRef[] = [];
    let position = 1;
    for (let i = 0; i < side.flanges.length; i++) {
      features.push({ kind: "flange", arrayIndex: i, position: position++ });
    }
    for (let i = 0; i < side.innerFrezLines.length; i++) {
      features.push({ kind: "innerFrez", arrayIndex: i, position: position++ });
    }
    return features;
  }

  export function getFeatureByPosition(side: SideConfig, position: number): FeatureRef | null {
    return getUnifiedFeatures(side).find(f => f.position === position) ?? null;
  }
  ```

  Rationale: The visual rendering order in `side-editor.tsx` renders all flanges first, then all inner FREZ lines. This helper captures that ordering as a single sequence with unified 1-based positions.

- [ ] **Step 2. Update CTRL+1..9 hotkey handler in `hotkeys.tsx`**

  Modify the `Mod+1` through `Mod+9` loop at `hotkeys.tsx:134-148` to use the unified feature ordering instead of only checking `sideConfig.flanges.length > i`.

  Replace the current logic:
  ```ts
  // Current: only selects flanges
  if (sideConfig.flanges.length > i) {
    flushSync(() => setSelectedFlangeIndex(i));
    focusFlangeInput(selectedSide, i);
  }
  ```

  With unified logic that resolves the feature at position `i+1` (CTRL+1 = position 1) and sets the correct selection state:
  ```ts
  const feature = getFeatureByPosition(sideConfig, i + 1);
  if (feature) {
    if (feature.kind === "flange") {
      flushSync(() => {
        setSelectedFlangeIndex(feature.arrayIndex);
        setSelectedInnerFrezIndex(null);
      });
      focusFlangeInput(selectedSide, feature.arrayIndex);
    } else {
      flushSync(() => {
        setSelectedInnerFrezIndex(feature.arrayIndex);
        setSelectedFlangeIndex(null);
      });
      focusInnerFrezInput(selectedSide, feature.arrayIndex);
    }
  }
  ```

  Rationale: This is the core fix — CTRL+N now resolves to whichever feature occupies that position in the unified sequence.

- [ ] **Step 3. Add `focusInnerFrezInput` helper in `hotkeys.tsx`**

  Currently only `focusFlangeInput` and `focusLastFlangeInput` exist (lines 38-60). Add an equivalent for inner FREZ inputs. The inner FREZ inputs also use `data-side` attributes (they share the same `inputDataProps` pattern — see `side-editor.tsx:517-518`).

  Add alongside the existing helpers:
  ```ts
  function focusInnerFrezInput(side: SideKey, index: number) {
    setTimeout(() => {
      const inputs = getFlangeInputs(side);
      // Inner FREZ inputs come after flange inputs in DOM order.
      // Offset by the flange count to reach the correct inner FREZ input.
      const flangeCount = document.querySelectorAll(`input[data-side="${side}"]`).length;
      // We need the actual flange count from the model, not DOM — but since
      // the inputs are rendered in order (flanges then innerFrez), we can
      // calculate the offset. However, the simplest approach: add a data-feature
      // attribute or use the existing data-side + positional approach.
      // Actually, the simplest robust approach: query all inputs with data-side
      // and index past the flange section.
      const allInputs = Array.from(inputs);
      // Find flange count from DOM by counting inputs that belong to FlangeChip/FlangeBlock
      // Simpler: just focus by overall index. Flanges occupy indices 0..flangeCount-1,
      // inner frez starts at flangeCount.
      // We need the flange count. We can read it from the model via context.
      // For now, use a data attribute approach.
    }, 0);
  }
  ```

  Actually, the cleanest approach is to add a `data-feature-type` attribute to distinguish. But to keep changes minimal, we can simply compute the offset. Since the `SheetMetalHotkeys` component has access to `model`, we can pass the flange count:

  ```ts
  function focusInnerFrezInput(side: SideKey, flangeCount: number, innerFrezIndex: number) {
    setTimeout(() => {
      const inputs = getFlangeInputs(side);
      const targetIndex = flangeCount + innerFrezIndex;
      if (inputs.length > targetIndex) {
        inputs[targetIndex].focus();
        inputs[targetIndex].select();
      }
    }, 0);
  }
  ```

  Rationale: Both flanges and inner FREZ inputs share `data-side` attribute. They are rendered in order (flanges first, then inner FREZ), so the Nth inner FREZ input is at overall index `flangeCount + innerFrezIndex`.

- [ ] **Step 4. Update Z label numbers in `side-editor.tsx`**

  The `InnerFrezChip` and `InnerFrezBlock` components currently show `Z{index + 1}` (their own array index + 1). They need to show the unified position instead.

  In `SideEditor`, compute the unified positions for inner FREZ lines and pass them down. The simplest approach: compute the offset (which is `config.flanges.length`) and pass a `unifiedPosition` prop.

  Update `InnerFrezChip` and `InnerFrezBlock` to accept a `unifiedPosition` prop:
  - Change the label from `Z{index + 1}` to `Z{unifiedPosition}`
  - In the rendering loops, pass `unifiedPosition={config.flanges.length + i + 1}`

  Files to modify:
  - `alugamma/src/features/sheet-metal/side-editor.tsx` — InnerFrezChip (line 311), InnerFrezBlock (line 372), and the two rendering sites (lines 509-521 for horizontal, lines 609-621 for vertical)

  Rationale: This is the visual fix — Z labels now show their position in the unified sequence (e.g. Z3 instead of Z1).

- [ ] **Step 5. Update `focusLastFlangeInput` to handle inner FREZ fallback**

  When pressing Z to add an inner FREZ, `hotkeys.tsx:206` calls `focusLastFlangeInput`. This should instead focus the last inner FREZ input. Update the Z hotkey handler at line 195-208 to call the new `focusInnerFrezInput` helper instead.

  Rationale: After adding an inner FREZ, focus should land on the new inner FREZ input, not the last flange input.

- [ ] **Step 6. Update the hotkeys panel documentation in `hotkeys-panel.tsx`**

  Update the CTRL+NUM row (or add one if missing) in `alugamma/src/features/settings/hotkeys-panel.tsx` to document that CTRL+1..9 selects the Nth feature (flange or inner FREZ) by unified position.

  Add a row like:
  ```
  CTRL+1..9  →  Select feature #1..9 (F or Z)
  ```

  Rationale: Users need to know the CTRL+NUM hotkeys now work for Z features too.

## Verification Criteria

- [ ] Create 3 flanges on a side: they show as F1, F2, F3
- [ ] Add 1 inner FREZ line: it shows as Z4 (not Z1)
- [ ] CTRL+4 selects and highlights the Z4 inner FREZ line
- [ ] Add another flange: it shows as F5
- [ ] CTRL+5 selects and highlights F5
- [ ] CTRL+1, CTRL+2, CTRL+3 still correctly select F1, F2, F3
- [ ] Q/E hotkeys still work correctly on the selected inner FREZ (notch/span toggles)
- [ ] Pressing Z focuses the new inner FREZ input (not the last flange input)
- [ ] Removing a feature (Shift+F or Shift+Z) and re-adding shows correct renumbering
- [ ] Vertical (left/right) and horizontal (top/bottom) side editors both show correct unified labels

## Potential Risks and Mitigations

1. **DOM input ordering assumption breaks if rendering order changes**
   Mitigation: The unified ordering helper (`getUnifiedFeatures`) is the single source of truth. If rendering order changes, update the helper to match. Consider adding `data-feature-position` attributes to inputs for robustness.

2. **Existing saved designs with inner FREZ lines**
   Mitigation: No data model changes required — the unified numbering is purely a view/hotkey concern computed at render time from existing arrays. Saved designs load and display correctly with the new numbering.

3. **CTRL+NUM conflicts with browser shortcuts (CTRL+1..9 switches tabs in some browsers)**
   Mitigation: Already handled — the existing `e.preventDefault()` at `hotkeys.tsx:139` suppresses browser behavior. No change needed.

4. **`focusInnerFrezInput` relies on DOM order matching array order**
   Mitigation: The side-editor renders features in a deterministic order (flanges then inner FREZ). Add a comment documenting this coupling. For extra safety, add `data-feature-position` attributes to inputs.

## Alternative Approaches

1. **Merge flanges and innerFrezLines into a single unified array**: Store all features in one array with a discriminator type. This would be the cleanest data model but requires a data migration for saved designs and touches many more files (context, types, geometry, dxf, convex validators). Overkill for this UX fix.

2. **Add `data-feature-position` attributes to inputs**: Instead of computing offsets, add explicit position attributes to each input element and query by that. Simpler focus logic but requires touching the chip/block components. Could be combined with Step 3 for robustness.

3. **Keep separate numbering but expand CTRL+NUM range**: Use CTRL+1..5 for flanges and CTRL+6..9 for inner FREZ. This avoids the unified numbering concept entirely but is less intuitive and limits the number of features per side.
