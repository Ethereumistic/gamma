# CNC Simulator: Fine-Tuning Plan v4

## Context & Current State

Working codebase after v3:
- `usePlayback.ts` — time-based playback with `Float64Array` duration table, cumulative prefix sums, wall-clock rAF loop, `seekToLine()`
- `GeometryViewer.tsx` — rapid inference, `lastKnownSeqRef`/`stableActiveSeq` for flicker-free highlights, continuous `motion.circle` dot, persistent info card
- `LayerControls.tsx` — layer toggles + RAPIDS toggle
- `PlaybackControls.tsx` — real mm:ss timer, speed slider x1–x100
- `CNCPipelinePage.tsx` — fully migrated parent

---

## Issue 1 — Navbar "Time" is ~1/3 too high vs real playback duration

### Root Cause

The navbar displays `state.generate.estimated_time` which comes from the backend and is calculated using a **different** feed-rate assumption than the frontend physics constants (`CUT_SPEED_MM_PER_S = 5500 / 60`).

The frontend `totalDuration` (computed in `usePlayback`) is the ground truth for what the simulator actually plays — it is derived directly from real segment lengths at the exact same feed rate used for animation. Use that instead.

### Fix — `CNCPipelinePage.tsx`

Replace this in the portal navbar section:

```tsx
// OLD
<span className="text-slate-400 whitespace-nowrap">
  Time: <span className="text-slate-200 font-medium ml-1">{formatTime(state.generate.estimated_time)}</span>
</span>
```

With:

```tsx
// NEW — use the physics-accurate totalDuration from usePlayback
// totalDuration is in seconds at speed=1. Only show when "done" (has real segments).
<span className="text-slate-400 whitespace-nowrap">
  Time:{" "}
  <span className="text-slate-200 font-medium ml-1">
    {state.status === "done" && totalDuration > 0
      ? formatTime(totalDuration)
      : formatTime(state.generate.estimated_time)}
  </span>
</span>
```

`totalDuration` is already returned from `usePlayback` and available in `CNCPipelinePage`. No other changes needed.

---

## Issue 2 — Slider time counter freezes during Framer Motion animation segments

### Root Cause

The `PlaybackControls` time display is:
```ts
formatDuration(totalDuration * (currentLine / Math.max(1, totalLines - 1)) / speed)
```

This is driven by `currentLineIndex` from React state. The problem is that `currentLineIndex` advances in discrete jumps via `setCurrentLineIndex` in the rAF loop. For a long segment (e.g. 3000 mm = ~32 s at speed=1), the rAF loop may stay on the same line index for many real seconds because the binary search keeps resolving to the same line — the counter visually freezes.

### Fix — `usePlayback.ts` + `PlaybackControls.tsx`

Export `simTimeRef` as a readable value via a second piece of state, or better: expose the raw elapsed simulation time as a live ref that `PlaybackControls` can read. The cleanest approach is to add a `currentSimTime` state that is updated on every rAF frame alongside `currentLineIndex`.

**In `usePlayback.ts`**, add:
```ts
const [currentSimTime, setCurrentSimTime] = useState(0)
```

In the `animate` callback, after advancing `simTimeRef.current`:
```ts
setCurrentSimTime(simTimeRef.current)  // add this line, right before the binary search line
```

Also update `seekToLine`:
```ts
setCurrentSimTime(cumulativeTime[clamped])
```

Return it:
```ts
return {
  // ... existing ...
  currentSimTime,   // NEW: elapsed seconds at speed=1, updates every rAF frame
}
```

**In `CNCPipelinePage.tsx`**, pass it through:
```tsx
<PlaybackControls
  // ... existing ...
  currentSimTime={currentSimTime}  // NEW
/>
```

**In `PlaybackControls.tsx`**, add to props interface:
```ts
currentSimTime?: number  // seconds elapsed at speed=1, live rAF-driven
```

Replace the time display:
```tsx
// OLD
`${formatDuration(totalDuration * (currentLine / Math.max(1, totalLines - 1)) / speed)}`

// NEW — use live sim time divided by speed for wall-clock elapsed
{totalDuration !== undefined && currentSimTime !== undefined
  ? `${formatDuration(currentSimTime / speed)} / ${formatDuration(totalDuration / speed)}`
  : `${currentLine} / ${Math.max(0, totalLines - 1)}`
}
```

This makes the timer update smoothly on every animation frame instead of only when the line index changes.

---

## Issue 3 — Speed range: change from x1–x100 to x0.5–x10 with 0.1 steps

### Fix — `PlaybackControls.tsx`

The speed slider `min/max/step` and the label need updating:

```tsx
// OLD
<Slider
  value={[speed]}
  min={1}
  max={100}
  step={1}
  onValueChange={(val) => onSpeedChange(val[0])}
  className="w-24"
/>
<span className="text-[10px] font-mono text-emerald-400 tabular-nums w-8">{speed}x</span>
```

```tsx
// NEW
<Slider
  value={[speed]}
  min={0.5}
  max={10}
  step={0.1}
  onValueChange={(val) => onSpeedChange(val[0])}
  className="w-24"
/>
<span className="text-[10px] font-mono text-emerald-400 tabular-nums w-10">{speed.toFixed(1)}x</span>
```

### Fix — `usePlayback.ts`

Change the default speed:
```ts
// OLD
const [playbackSpeed, setPlaybackSpeed] = useState(1)
// NEW
const [playbackSpeed, setPlaybackSpeed] = useState(1.0)  // same value, but note range is now 0.5–10
```

No other changes needed in the hook — it already multiplies `playbackSpeed` as a float.

### Fix — `CNCPipelinePage.tsx`

The `onSpeedChange` callback passes directly through, no changes needed there.

---

## Issue 4 — Tool dot "azimuth" artifact: dot jumps across a cut line mid-animation

### Root Cause

When the Framer Motion dot is animating from point A→B (a cut segment), and then a rapid move triggers (`activeRapid` becomes non-null), the `dotTarget` switches immediately to the rapid's endpoint. But Framer Motion's current animation is mid-flight, so it smoothly interpolates from wherever the dot currently is (mid-cut) to the rapid destination — visually it looks like the tool cuts diagonally across space.

The fix is: **never let `dotTarget` switch while an active cut animation is in progress.** The dot must finish its current segment before starting the rapid.

However, since Framer Motion doesn't expose "animation complete" as a synchronous value, the correct approach is architectural: **use `stableActiveSeq` to determine the dot target, not `activeSeqIndex`**.

When `activeSeqIndex` is `null` (we're on a G0 line), `stableActiveSeq` still holds the last cut's seq_index. We should animate the dot to the END of that last cut (which it should already be at or near), wait for the rapid to become the `dotTarget`, and only then move.

The real bug is that `dotTarget` switches to `activeRapid.x2/y2` the instant `activeSeqIndex` becomes null — which is the moment the G-code line changes to G0, not when the visual animation finishes the previous cut.

**Fix strategy:** Add a small sequencing layer. Track the dot's **committed target** separately from the live derived target. Only update the committed target when the new target is the logical *next step* after the current one:

**In `GeometryViewer.tsx`**, replace the `dotTarget` useMemo with a ref-based committed target:

```tsx
// Replace the dotTarget useMemo entirely with this pattern:

const committedDotRef = useRef<{ x: number; y: number; duration: number; isRapid: boolean } | null>(null)
const lastCommittedSeqRef = useRef<number | null>(null)
const lastCommittedRapidIdRef = useRef<string | null>(null)

const dotTarget = useMemo(() => {
  // Priority 1: a cut segment is actively mapped to current line
  if (activeSegment) {
    // Only update if this is a new segment (avoid resetting mid-animation)
    if (lastCommittedSeqRef.current !== activeSegment.seq_index) {
      lastCommittedSeqRef.current = activeSegment.seq_index
      lastCommittedRapidIdRef.current = null
      const len = Math.hypot(activeSegment.x2 - activeSegment.x1, activeSegment.y2 - activeSegment.y1)
      committedDotRef.current = {
        x: activeSegment.x2,
        y: activeSegment.y2,
        duration: Math.max(0.016, len / (CUT_SPEED_MM_PER_S * playbackSpeed)),
        isRapid: false,
      }
    }
    return committedDotRef.current
  }

  // Priority 2: we're on a rapid move (activeSeqIndex is null, activeRapid found)
  if (activeRapid) {
    // Only commit the rapid if we've already committed (and presumably finished)
    // the cut that precedes it — i.e. lastCommittedSeqRef === activeRapid.fromSeq
    const prerequisiteMet =
      activeRapid.fromSeq === -1 ||                              // home rapid, always OK
      lastCommittedSeqRef.current === activeRapid.fromSeq        // previous cut was committed

    if (prerequisiteMet && lastCommittedRapidIdRef.current !== activeRapid.id) {
      lastCommittedRapidIdRef.current = activeRapid.id
      const len = Math.hypot(activeRapid.x2 - activeRapid.x1, activeRapid.y2 - activeRapid.y1)
      committedDotRef.current = {
        x: activeRapid.x2,
        y: activeRapid.y2,
        duration: Math.max(0.016, len / (RAPID_SPEED_MM_PER_S * playbackSpeed)),
        isRapid: true,
      }
    }
    return committedDotRef.current
  }

  // Priority 3: hold last committed position
  return committedDotRef.current
}, [activeSegment, activeRapid, playbackSpeed])
```

This ensures the dot only ever animates to targets in strict sequence order: cut → rapid → cut → rapid, never skipping ahead.

---

## Issue 5 — Traceability mode: per-layer progressive draw

### Overview

Add a "trace" mode for each CNC layer (HOLES, FREZ, FREZ_135, CUT) and RAPIDS. When a layer's trace mode is ON:
- The layer's lines are **hidden at rest** (not drawn until the tool passes over them).
- As playback advances, only the segments whose `seq_index <= stableActiveSeq` AND whose layer has trace ON become visible — they get drawn progressively.
- When trace is OFF for a layer, that layer behaves as today (all lines visible, past = full colour, future = dimmed).

### New state — `CNCPipelinePage.tsx`

```ts
// Which layers have trace mode enabled (default: all off = normal view)
const [traceMode, setTraceMode] = useState<Record<string, boolean>>({
  HOLES: false,
  FREZ: false,
  FREZ_135: false,
  CUT: false,
  RAPIDS: false,
})

const handleTraceModeToggle = (layer: string) => {
  setTraceMode(prev => ({ ...prev, [layer]: !prev[layer] }))
}
```

Pass these down:
```tsx
<GeometryViewer
  // ...existing...
  traceMode={traceMode}
/>
<LayerControls
  // ...existing...
  traceMode={traceMode}
  onTraceModeToggle={handleTraceModeToggle}
/>
```

### New UI — `LayerControls.tsx`

For each CNC layer (and the RAPIDS row), add a small trace toggle button next to the existing target/hop button. Use a filled-circle icon or a simple "T" to indicate trace mode. When active, highlight it.

Add to props interface:
```ts
traceMode?: Record<string, boolean>
onTraceModeToggle?: (layer: string) => void
```

In `renderLayer`, add after the existing `Target` hop button:
```tsx
{!isRef && onTraceModeToggle && (
  <button
    onClick={() => onTraceModeToggle(layer)}
    className={`p-0.5 hover:bg-white/10 rounded group transition-colors ${
      traceMode?.[layer] ? "text-amber-400" : ""
    }`}
    title={traceMode?.[layer] ? `Disable trace mode for ${layer}` : `Enable trace mode for ${layer}`}
  >
    {/* Simple trace icon — a horizontal line being drawn */}
    <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-colors ${traceMode?.[layer] ? "stroke-amber-400" : "stroke-slate-500 group-hover:stroke-amber-300"}`}>
      <line x1="1" y1="5" x2="9" y2="5" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="9" cy="5" r="1.5" fill="currentColor" className={traceMode?.[layer] ? "fill-amber-400" : "fill-slate-500 group-hover:fill-amber-300"} />
    </svg>
  </button>
)}
```

Also add a trace toggle for the RAPIDS row:
```tsx
{onToggleRapids && onTraceModeToggle && (
  <button
    onClick={() => onTraceModeToggle("RAPIDS")}
    className={`p-0.5 hover:bg-white/10 rounded group transition-colors ${
      traceMode?.["RAPIDS"] ? "text-amber-400" : ""
    }`}
    title={traceMode?.["RAPIDS"] ? "Disable trace for rapids" : "Enable trace for rapids"}
  >
    <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-colors ${traceMode?.["RAPIDS"] ? "stroke-amber-400" : "stroke-slate-500 group-hover:stroke-amber-300"}`}>
      <line x1="1" y1="5" x2="9" y2="5" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="9" cy="5" r="1.5" fill="currentColor" className={traceMode?.["RAPIDS"] ? "fill-amber-400" : "fill-slate-500 group-hover:fill-amber-300"} />
    </svg>
  </button>
)}
```

### Rendering logic — `GeometryViewer.tsx`

Add `traceMode` to the `Props` interface:
```ts
traceMode?: Record<string, boolean>
```

**Cut segment rendering** — in the `visibleSegments.map` loop, add a trace visibility check:

```tsx
// BEFORE the existing isHovered/isActive/isPast logic:
const isTracedLayer = traceMode?.[seg.layer] ?? false
const isTracedVisible = !isTracedLayer || (stableActiveSeq !== null && seg.seq_index <= stableActiveSeq)

// If trace is on and this segment hasn't been reached yet, don't render it
if (!isTracedVisible) return null
```

So the full per-segment logic becomes:

```tsx
{visibleSegments.map((seg) => {
  const isTracedLayer   = traceMode?.[seg.layer] ?? false
  const isTracedVisible = !isTracedLayer || (stableActiveSeq !== null && seg.seq_index <= stableActiveSeq)
  if (!isTracedVisible) return null

  const isHovered  = seg.seq_index === hoveredSeq
  const isActive   = stableActiveSeq !== null && seg.seq_index === stableActiveSeq
  const isPast     = stableActiveSeq !== null && seg.seq_index < stableActiveSeq
  // ... rest of existing color/width logic unchanged ...
})}
```

**Rapid segment rendering** — wrap the existing rapids render with a trace check:

```tsx
{showRapids && rapidSegments.map((r) => {
  const isActiveRapid = activeRapid?.id === r.id

  // Trace mode for rapids: only show rapids that have already been traversed
  const rapidTraceModeOn = traceMode?.["RAPIDS"] ?? false
  if (rapidTraceModeOn) {
    // A rapid is "past" if its toSeq <= stableActiveSeq (the tool has started the next cut)
    const isPastRapid = stableActiveSeq !== null && r.toSeq <= stableActiveSeq
    if (!isPastRapid && !isActiveRapid) return null
  }

  return (
    <line
      key={r.id}
      // ... existing line props unchanged ...
    />
  )
})}
```

---

## Issue 6 — Ref layers (SHEETS, "0") must be fully excluded from rapids inference and animation

### Root Cause

Currently in `GeometryViewer.tsx`, `rapidSegments` is derived from `[...segments].sort(...)` which includes ALL segments — including SHEETS and "0" layer segments. If a SHEETS segment appears in the sorted order, rapids will be incorrectly inferred connecting to/from it, producing phantom rapid lines and wrong dot destinations.

Similarly, `stableActiveSeq` and the dot animation must never lock onto a ref-layer segment.

### Fix — `GeometryViewer.tsx`

Define the CNC-only filter at the top of the component (it already exists as a constant, just use it consistently):

```tsx
// Only these layers are real toolpath segments — used for rapid inference and dot animation
const CNC_LAYERS = new Set(["CUT", "FREZ", "FREZ_135", "HOLES"])
```

In the `rapidSegments` useMemo, filter to CNC layers only:

```tsx
// OLD
const sorted = [...segments].sort((a, b) => a.seq_index - b.seq_index)

// NEW — only CNC layers participate in the toolpath sequence
const sorted = [...segments]
  .filter(s => CNC_LAYERS.has(s.layer))
  .sort((a, b) => a.seq_index - b.seq_index)
```

In the `activeSegment` derivation, add a layer guard:

```tsx
// OLD
const activeSegment = activeSeqIndex !== null
  ? segments.find(s => s.seq_index === activeSeqIndex) ?? null
  : null

// NEW — ignore ref-layer segments for dot animation purposes
const activeSegment = activeSeqIndex !== null
  ? segments.find(s => s.seq_index === activeSeqIndex && CNC_LAYERS.has(s.layer)) ?? null
  : null
```

In the `lastKnownSeqRef` update, guard against ref layers:

```tsx
// OLD
if (activeSeqIndex !== null) lastKnownSeqRef.current = activeSeqIndex

// NEW
if (activeSeqIndex !== null) {
  const seg = segments.find(s => s.seq_index === activeSeqIndex)
  if (seg && CNC_LAYERS.has(seg.layer)) {
    lastKnownSeqRef.current = activeSeqIndex
  }
}
```

This ensures SHEETS and "0" segments are completely invisible to the rapid inference, dot animation, and the `stableActiveSeq` tracking. They continue to render as dashed reference lines as before.

---

## Summary of Changes Per File

### `usePlayback.ts`
- Add `currentSimTime` state, update it every rAF frame and on seek
- Export `currentSimTime`
- Default speed stays `1.0` (range is enforced by the slider, not the hook)

### `PlaybackControls.tsx`
- Add `currentSimTime?: number` prop
- Replace time display formula: use `currentSimTime / speed` for elapsed, `totalDuration / speed` for total
- Speed slider: `min={0.5}` `max={10}` `step={0.1}`
- Speed label: `{speed.toFixed(1)}x` (needs 1 decimal place for 0.5 etc)
- Widen speed label span: `w-10` instead of `w-8`

### `CNCPipelinePage.tsx`
- Navbar Time: replace `formatTime(state.generate.estimated_time)` with `formatTime(totalDuration)` when `totalDuration > 0`
- Pass `currentSimTime` to `<PlaybackControls>`
- Add `traceMode` state + `handleTraceModeToggle`
- Pass `traceMode` to `<GeometryViewer>` and `<LayerControls>`
- Pass `onTraceModeToggle={handleTraceModeToggle}` to `<LayerControls>`

### `LayerControls.tsx`
- Add `traceMode?: Record<string, boolean>` and `onTraceModeToggle?: (layer: string) => void` props
- In `renderLayer`: add trace toggle button after the Target hop button, for CNC layers only
- In RAPIDS row: add trace toggle button
- Trace button style: amber when active, slate otherwise

### `GeometryViewer.tsx`
- Add `traceMode?: Record<string, boolean>` prop
- `rapidSegments` useMemo: filter to CNC layers only (exclude SHEETS, "0")
- `activeSegment`: add `CNC_LAYERS.has(s.layer)` guard
- `lastKnownSeqRef` update: add CNC layer guard
- `dotTarget`: replace useMemo with ref-based committed target (see Issue 4 fix)
- Cut segment map: add `isTracedVisible` check — skip rendering if trace ON and seq > stableActiveSeq
- Rapids map: add RAPIDS trace check — skip if trace ON and not past + not active

---

## Constant Reference

No constants change. For reference:
```ts
// usePlayback.ts
const CUT_SPEED_MM_PER_S   = 5500 / 60   // 91.667 mm/s
const RAPID_SPEED_MM_PER_S = 18000 / 60  // 300 mm/s
const DWELL_DURATION_S     = 0.04

// GeometryViewer.tsx (mirrored)
const CUT_SPEED_MM_PER_S   = 5500 / 60
const RAPID_SPEED_MM_PER_S = 18000 / 60
```