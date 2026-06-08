# DXF Golden Files

These are the **current** (pre-task) `buildDxf()` outputs for the
two production designs listed in `production-designs.ts`. They are
byte-checked fixtures — the
`dxf-golden.test.ts` regression test asserts that
`computeSheetMetalGeometry(model) → buildDxf(...)` produces
**byte-identical** output to these files for the corresponding
design, after every change in TASK 10.

## Why these exist

TASK 10 adds the per-part CUT/FREZ/HOLES joining logic. The whole
point of "Phase 1, zero risk" is that the **sheet-metal export is
unchanged**. These golden files are the proof.

## How to regenerate

The test file is self-regenerating in setup mode:

```bash
pnpm vitest run src/features/sheet-metal/dxf-golden.test.ts --update
```

The implementer reviews `git diff` of the `.dxf` files before
committing. **Empty diff = safe to merge.**

## How to verify the test passes (no auth required)

```bash
pnpm vitest run src/features/sheet-metal/dxf-golden.test.ts
```

The test reads the local `production-designs.ts` fixtures (not
Convex), runs the geometry engine + DXF writer, and compares the
output bytes against the file in this folder. No network or auth
needed.

## Files

- `flappy-flaps.dxf` — 3,897 bytes — small square part with reliefs,
  flaps, and an inner frez
- `gabrovo.dxf` — 3,593 bytes — wider part with multi-flange
  stacking, holes pattern, and reliefs

Both files were generated on 2026-06-08 from the models in
`production-designs.ts`, which were copy-pasted from the Convex
`designs` table by the user.
