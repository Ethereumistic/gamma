# CNC Simulator: Rapid Moves, Continuous Tool Animation & Time-Based Playback

**Context:**
You are working on a React + Vite frontend for a CNC DXF-to-NC-code pipeline. We have a `<GeometryViewer>` component that renders 2D toolpaths using SVG and animates a cutting tool dot using `motion/react` (Framer Motion).
Currently, the backend sends an array of `segments` (the actual cutting moves). The frontend uses a `lineToSegmentMap` to sync the current G-code line to an `activeSeqIndex` (the segment currently being cut).

**The Problems:**
1. We are only visualizing the "cut" segments. When the machine retracts and performs a "rapid" traverse move (G0) to the next contour, there is no visual line.
2. Because the animated yellow dot only renders and animates when a cut segment is active, it disappears/flickers during rapid moves — especially bad on layers with many plunges like `FREZ`.
3. `usePlayback.ts` treats every G-code line as an equal time unit. A 1 mm move takes the same wall-clock time as a 3000 mm move — this is physically wrong.
4. The info card in the top-left only appears when a toolpath segment is active; it vanishes for G-code header lines, tool switches, and any line that has no mapped segment — causing distracting pop-in/pop-out.
5. All of the above combine to produce heavy flickering of the geometry (segment highlighting) and the info card during playback, especially for `FREZ`.

---

## Step 1: Derive Rapid Segments (Frontend Inference)
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

We do not need to change the backend. We can infer rapid moves by finding the gaps between contiguous cutting segments.

* Inside `GeometryViewer`, create a `useMemo` that sorts the *full* `segments` array (not just visible ones) by `seq_index` — rapids bridge the geometry regardless of layer visibility.
* Iterate through the sorted segments. Whenever the end point `(x2, y2)` of `segment[i]` does not match the start point `(x1, y1)` of `segment[i+1]` (tolerance > 0.001 mm), generate a "rapid" segment bridging them.
* Also generate a **initial rapid** from origin `(0, 0)` to the very first segment's `(x1, y1)` if that distance is > 0.001 — the machine always starts at home.
* Store these in a `rapidSegments` array with a `fromSeq` / `toSeq` pair so we can later identify which rapid is "active" during playback.

```typescript
const rapidSegments = useMemo(() => {
  const rapids: RapidSegment[] = [];
  const sorted = [...segments].sort((a, b) => a.seq_index - b.seq_index);

  // Initial rapid: machine home → first cut
  if (sorted.length > 0 && Math.hypot(sorted[0].x1, sorted[0].y1) > 0.001) {
    rapids.push({
      id: "rapid-home",
      x1: 0, y1: 0, x2: sorted[0].x1, y2: sorted[0].y1,
      fromSeq: -1, toSeq: sorted[0].seq_index,
    });
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (Math.hypot(next.x1 - curr.x2, next.y1 - curr.y2) > 0.001) {
      rapids.push({
        id: `rapid-${curr.seq_index}-${next.seq_index}`,
        x1: curr.x2, y1: curr.y2, x2: next.x1, y2: next.y1,
        fromSeq: curr.seq_index, toSeq: next.seq_index,
      });
    }
  }
  return rapids;
}, [segments]); // Note: use full `segments`, not `visibleSegments`
```

Add a local type at the top of the file:

```typescript
interface RapidSegment {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  fromSeq: number; // seq_index of the segment that ends here (-1 = home)
  toSeq: number;   // seq_index of the segment that starts here
}
```

---

## Step 2: Render the Rapid Layer
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

* Accept a `showRapids` boolean prop (default `true`). This is wired to a toggle in `LayerControls` (Step 6).
* Inside the `<g>` tag of the SVG, render rapids **before** cutting segments so they appear underneath.
* Style: `stroke="#ef4444"` (red), `strokeDasharray` scaled to viewBox, `opacity={0.45}`.
* Highlight the **active rapid** (see Step 4) at full opacity and thicker stroke, so it's obvious the tool is traversing.

```tsx
{showRapids && rapidSegments.map((r) => {
  const isActiveRapid = activeRapid?.id === r.id;
  return (
    <line
      key={r.id}
      x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
      stroke="#ef4444"
      strokeWidth={isActiveRapid ? viewW * 0.006 : viewW * 0.0015}
      strokeDasharray={`${viewW * 0.008} ${viewW * 0.005}`}
      opacity={isActiveRapid ? 0.9 : 0.35}
      style={{ pointerEvents: "none" }}
    />
  );
})}
```

---

## Step 3: Determine the Active Rapid
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

We need to know if the playhead is currently between two cut segments (i.e., on a rapid move). Derive `activeRapid` from `activeSeqIndex` and the `rapidSegments` array:

```typescript
const activeRapid = useMemo(() => {
  if (activeSeqIndex === null) return null;
  // A rapid is "active" when the playhead is at a seq_index that equals
  // a rapid's `fromSeq` (meaning: we just finished that cut and haven't
  // started the next one yet — the tool is traversing).
  return rapidSegments.find(r => r.fromSeq === activeSeqIndex) ?? null;
}, [activeSeqIndex, rapidSegments]);
```

> **Note:** The playback engine advances `currentLineIndex` line-by-line through the G-code. When the current line maps to a segment via `lineToSegmentMap`, `activeSeqIndex` resolves to that segment. When the line is a G0 rapid or a non-toolpath header line, `lineToSegmentMap` returns `undefined` and `activeSeqIndex` is `null`. We use the *last known* `activeSeqIndex` (tracked via a ref) to identify which rapid is in-flight.

Add a `lastKnownSeqRef` inside the component:

```typescript
const lastKnownSeqRef = useRef<number | null>(null);
if (activeSeqIndex !== null) lastKnownSeqRef.current = activeSeqIndex;

const activeRapid = useMemo(() => {
  const refSeq = lastKnownSeqRef.current;
  if (activeSeqIndex !== null || refSeq === null) return null;
  return rapidSegments.find(r => r.fromSeq === refSeq) ?? null;
}, [activeSeqIndex, rapidSegments]);
```

---

## Step 4: Fix the Machining Dot — Continuous, Flicker-Free Animation
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

The root cause of flickering is that `<motion.circle>` unmounts and remounts every time `activeSegment` becomes `null` (during rapids / header lines). Framer Motion resets to `initial` on mount, causing teleportation.

**Rules:**
* Render `<motion.circle>` **unconditionally** once the simulation has started (`hasStarted` = `currentLineIndex > 0` or `isPlaying`).
* Never use `initial` for position. Let Framer Motion interpolate continuously from wherever the dot currently is.
* Keep a `dotTarget` derived value that always resolves to a valid `{x, y}`:
  * If `activeSegment` exists → target is `(activeSegment.x2, activeSegment.y2)`.
  * Else if `activeRapid` exists → target is `(activeRapid.x2, activeRapid.y2)`.
  * Else → hold last known position (no change to `animate`).
* `duration` must reflect real travel time: use the cutting speed for cuts, rapid speed for rapids (see Step 5 for the constants).

```typescript
// Derive dot target — always defined once simulation starts
const RAPID_SPEED_MM_PER_SEC = 5500 / 60  // same as cutting for simplicity, or use a higher value

const dotTarget = useMemo(() => {
  if (activeSegment) {
    const len = Math.hypot(
      activeSegment.x2 - activeSegment.x1,
      activeSegment.y2 - activeSegment.y1
    );
    return {
      x: activeSegment.x2,
      y: activeSegment.y2,
      duration: Math.max(0.016, len / (CUT_SPEED_MM_PER_SEC * playbackSpeed)),
    };
  }
  if (activeRapid) {
    const len = Math.hypot(
      activeRapid.x2 - activeRapid.x1,
      activeRapid.y2 - activeRapid.y1
    );
    return {
      x: activeRapid.x2,
      y: activeRapid.y2,
      duration: Math.max(0.016, len / (RAPID_SPEED_MM_PER_SEC * playbackSpeed)),
    };
  }
  return null; // hold position
}, [activeSegment, activeRapid, playbackSpeed]);
```

```tsx
{/* Render unconditionally once started; key stays stable */}
{hasStarted && dotTarget && (
  <motion.circle
    key="tool-dot"
    animate={{ cx: dotTarget.x, cy: dotTarget.y }}
    transition={{ duration: dotTarget.duration, ease: "linear" }}
    r={viewW * 0.008}
    fill="#fbbf24"
    style={{ pointerEvents: "none" }}
  />
)}
```

`hasStarted` can be a simple derived boolean:
```typescript
const hasStarted = currentLineIndex > 0 || isPlaying;
```
Pass `isPlaying` and `currentLineIndex` as props, or derive them from context.

---

## Step 5: Time-Based Playback in `usePlayback.ts`
**Target File:** `src/features/cnc-pipeline/usePlayback.ts`

### The Problem
`usePlayback` currently advances the playhead by a fixed number of lines per millisecond, treating all G-code lines as equal. A G1 move for 0.5 mm and a G1 move for 3000 mm both take the same wall-clock time.

### The Solution
Replace the uniform `linesPerMs` formula with a **per-line duration table** that is computed once from the geometry and the line→segment map. Each line's wall-clock duration is derived from:
- The **length** of its mapped segment (if any).
- The **tool speed**: `5500 mm/min = 91.667 mm/s` for cutting moves (G1).
- A **rapid speed** for G0 moves: use `18000 mm/min = 300 mm/s` (a typical CNC rapid rate; expose as a constant so it can be tuned).
- Lines that have no segment (headers, comments, tool changes, M-codes) get a **fixed dwell duration** of `0.05 s` — short enough to feel instant but non-zero so the playhead visibly advances through them.

### New Hook Signature
Add two new parameters: `segments` (the geometry segments array) and `lineToSegmentMap`.

```typescript
export function usePlayback(
  maxLines: number,
  estimatedTime: number,
  segments: Segment[],                        // NEW
  lineToSegmentMap: Record<number, number>,   // NEW
)
```

### Build the Duration Table
Inside the hook, use a `useMemo` to produce a `Float32Array` (or plain `number[]`) of per-line durations **in seconds** at `playbackSpeed = 1`:

```typescript
const CUT_SPEED_MM_PER_S  = 5500 / 60;   // 91.667 mm/s  — G1 feed rate
const RAPID_SPEED_MM_PER_S = 18000 / 60; // 300 mm/s     — G0 rapid rate
const DWELL_DURATION_S     = 0.05;        // for non-geometry lines

const lineDurations = useMemo(() => {
  // Build a quick lookup: seq_index → segment
  const segBySeq = new Map(segments.map(s => [s.seq_index, s]));

  const durations = new Float32Array(maxLines);
  for (let i = 0; i < maxLines; i++) {
    const seqIdx = lineToSegmentMap[i];
    if (seqIdx === undefined) {
      durations[i] = DWELL_DURATION_S;
      continue;
    }
    const seg = segBySeq.get(seqIdx);
    if (!seg) {
      durations[i] = DWELL_DURATION_S;
      continue;
    }
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    // All mapped segments are feed (G1) moves
    durations[i] = len / CUT_SPEED_MM_PER_S;
  }
  return durations;
}, [maxLines, segments, lineToSegmentMap]);
```

### Build a Cumulative Time Array
For efficient seeking (e.g., when the user drags the timeline slider), precompute prefix sums:

```typescript
const cumulativeTime = useMemo(() => {
  const cum = new Float64Array(maxLines + 1); // cum[i] = wall-clock time at start of line i
  for (let i = 0; i < maxLines; i++) {
    cum[i + 1] = cum[i] + lineDurations[i];
  }
  return cum;
}, [lineDurations, maxLines]);

const totalDuration = cumulativeTime[maxLines]; // total sim duration in seconds at speed=1
```

### Replace the Animation Loop
Replace the current `linesToAdvance` logic with a **wall-clock accumulator** approach. Track elapsed simulation time (seconds at `speed=1`) and map it back to a line index using binary search on `cumulativeTime`.

```typescript
// New refs
const simTimeRef = useRef<number>(0);         // elapsed simulation seconds at speed=1
const wallClockRef = useRef<number>(0);       // last rAF timestamp in ms

const animate = useCallback((timestamp: number) => {
  if (!wallClockRef.current) wallClockRef.current = timestamp;

  const wallElapsedMs = timestamp - wallClockRef.current;
  wallClockRef.current = timestamp;

  // Advance simulation time by wall-clock delta × playback speed
  simTimeRef.current += (wallElapsedMs / 1000) * playbackSpeed;

  if (simTimeRef.current >= totalDuration) {
    simTimeRef.current = totalDuration;
    setCurrentLineIndex(maxLines - 1);
    setIsPlaying(false);
    return;
  }

  // Binary search for current line index
  const t = simTimeRef.current;
  let lo = 0, hi = maxLines;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulativeTime[mid + 1] <= t) lo = mid + 1;
    else hi = mid;
  }
  setCurrentLineIndex(lo);

  requestRef.current = requestAnimationFrame(animate);
}, [playbackSpeed, totalDuration, maxLines, cumulativeTime]);
```

### Seeking
When the user seeks by dragging the slider (which passes a line index), reset `simTimeRef` to `cumulativeTime[line]`:

```typescript
const seekToLine = useCallback((line: number) => {
  const clamped = Math.max(0, Math.min(maxLines - 1, line));
  simTimeRef.current = cumulativeTime[clamped];
  wallClockRef.current = 0; // will be reset on next rAF frame
  setCurrentLineIndex(clamped);
}, [cumulativeTime, maxLines]);
```

Expose `seekToLine` from the hook and use it everywhere `setCurrentLineIndex` is called externally (e.g., the "seek to start of layer" button, the timeline slider `onValueChange`, etc.).

### Updated Return Value
```typescript
return {
  isPlaying, setIsPlaying,
  currentLineIndex,
  seekToLine,           // replaces direct setCurrentLineIndex for external callers
  setCurrentLineIndex,  // keep for internal resets if needed
  playbackSpeed, setPlaybackSpeed,
  totalDuration,        // expose so UI can show total time
  activeLayers, setActiveLayers,
};
```

---

## Step 6: Persistent Info Card — Always Visible
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

### The Problem
The info card currently only renders when `displaySegment` is truthy — meaning it vanishes during rapid moves, tool changes, and G-code header lines. This causes distracting pop-in/pop-out.

### The Solution
The card must **always** be visible once the simulation has started. When no segment is active, show context-appropriate information derived from the current G-code line text or the last known segment.

**Add a `ncLines` prop** (the full NC text split into lines) so the component can inspect the current raw G-code line:

```typescript
interface Props {
  // ... existing props ...
  ncLines?: string[]          // NEW: full G-code split by \n
  isPlaying?: boolean         // NEW: needed for hasStarted
}
```

**Derive card content from multiple sources:**

```typescript
const currentRawLine = ncLines?.[currentLineIndex ?? 0] ?? ""

// Classify the current line type for the card header
const lineType = useMemo((): "cutting" | "rapid" | "tool-change" | "header" | "dwell" => {
  if (!currentRawLine) return "header"
  const l = currentRawLine.trim().toUpperCase()
  if (l.startsWith("T") || l.includes("M6") || l.includes("M06")) return "tool-change"
  if (l.startsWith("G0 ") || l.startsWith("G00 ")) return "rapid"
  if (l.startsWith("G1 ") || l.startsWith("G01 ")) return "cutting"
  if (l.startsWith("G4") || l.startsWith("G04")) return "dwell"
  return "header"
}, [currentRawLine])
```

**Card always renders with appropriate state:**

```tsx
{hasStarted && (
  <div
    style={{
      position: "absolute", top: 8, left: 8,
      background: "rgba(0,0,0,0.85)", color: "white",
      padding: "5px 10px", borderRadius: 5, fontSize: 12,
      pointerEvents: "none", zIndex: 30,
      border: "1px solid rgba(255,255,255,0.12)", lineHeight: 1.6,
      minWidth: 160,
    }}
  >
    {/* Header row — always shows context */}
    <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
      {hoveredSeq !== null
        ? "Inspecting"
        : lineType === "cutting"   ? "Machining"
        : lineType === "rapid"     ? "Rapid Move"
        : lineType === "tool-change" ? "Tool Change"
        : lineType === "dwell"     ? "Dwell"
        : "Program"}
    </div>

    {/* Segment details when a real segment is active or hovered */}
    {displaySegment ? (
      <>
        <div>
          Segment #{displaySeq! + 1}
          {" — "}
          <span style={{ color: LAYER_COLORS[displaySegment.layer] ?? "#fff" }}>
            {displaySegment.layer}
          </span>
          {!CNC_LAYERS.has(displaySegment.layer) && (
            <span style={{ color: "#94a3b8", marginLeft: 6, fontSize: 11 }}>(ref only)</span>
          )}
        </div>
        {nextSegment && (
          <div style={{ color: "#94a3b8" }}>
            Next: #{nextSeq! + 1} —{" "}
            <span style={{ color: LAYER_COLORS[nextSegment.layer] ?? "#fff" }}>
              {nextSegment.layer}
            </span>
          </div>
        )}
      </>
    ) : (
      /* Fallback: show raw G-code line so card never goes blank */
      <div style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 11 }}>
        {currentRawLine ? currentRawLine.trim().slice(0, 48) : "—"}
      </div>
    )}

    {/* Active rapid destination */}
    {activeRapid && !displaySegment && (
      <div style={{ color: "#ef4444", fontSize: 11, marginTop: 2 }}>
        → ({activeRapid.x2.toFixed(2)}, {activeRapid.y2.toFixed(2)})
      </div>
    )}
  </div>
)}
```

> This means the card is always present from the moment playback starts, its header label smoothly changes between "Machining / Rapid Move / Tool Change / Program", and it never goes blank or pops in/out.

---

## Step 7: Flicker-Free Geometry Highlighting
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

### The Problem
Segment highlighting (color, opacity, strokeWidth) reacts to `activeSeqIndex`, which snaps to `null` on every non-toolpath line. This causes the entire SVG to re-render with dimmed/bright segments multiple times per second during mixed rapid/cut sequences — visible as a geometry flicker.

### The Solution
Use the **last known active seq index** (from `lastKnownSeqRef` defined in Step 3) for ALL highlight logic instead of the raw `activeSeqIndex`. This way, the geometry's "current progress" never reverts just because the current G-code line is a comment or header.

```typescript
// Use this for all segment styling decisions:
const stableActiveSeq = activeSeqIndex ?? lastKnownSeqRef.current
```

Replace every occurrence of `activeSeqIndex !== null && seg.seq_index === activeSeqIndex` and `seg.seq_index < activeSeqIndex` in the segment rendering loop with the stable version:

```typescript
const isActive = stableActiveSeq !== null && seg.seq_index === stableActiveSeq
const isPast   = stableActiveSeq !== null && seg.seq_index < stableActiveSeq
```

This alone eliminates the geometry flicker. The visual progress of the toolpath is now monotonically increasing — it never steps backward because of a non-geometry G-code line.

---

## Step 8: RAPIDS Toggle in `LayerControls.tsx`
**Target File:** `src/features/cnc-pipeline/components/LayerControls.tsx`

Add a `showRapids` / `onToggleRapids` pair to the props and render a dedicated toggle styled consistently with the other layer indicators:

```typescript
interface Props {
  // ... existing ...
  showRapids: boolean
  onToggleRapids: (val: boolean) => void
}
```

```tsx
{/* Render after the ref layers divider */}
<div className="h-3 w-px bg-white/10" />
<button
  onClick={() => onToggleRapids(!showRapids)}
  className={`flex items-center gap-1.5 outline-none hover:text-white transition-all ${showRapids ? "opacity-100" : "opacity-40 hover:opacity-70"}`}
  title="Toggle rapid traverse moves"
>
  <div
    className="w-3 h-3 rounded-[2px] shrink-0 border border-dashed"
    style={{
      backgroundColor: showRapids ? "#ef444466" : "transparent",
      borderColor: showRapids ? "#ef4444" : "#64748b",
    }}
  />
  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
    RAPIDS
    <span className="ml-1 text-[9px] lowercase italic text-slate-600">G0</span>
  </span>
</button>
```

Wire `showRapids` state up in the parent page component alongside the other `visible` layer state.

---

## Summary of Changes

| File | What Changes |
|------|-------------|
| `usePlayback.ts` | New params `segments` + `lineToSegmentMap`; per-line duration table via `Float32Array`; cumulative time prefix sums; wall-clock accumulator rAF loop; `seekToLine()` helper; exposes `totalDuration` |
| `GeometryViewer.tsx` | `RapidSegment` type; `rapidSegments` useMemo; `lastKnownSeqRef` for stable seq tracking; `stableActiveSeq` for flicker-free highlights; `activeRapid` derived state; conditional `<motion.circle>` with continuous `dotTarget`; always-visible info card with `lineType` classification; new props `showRapids`, `ncLines`, `isPlaying` |
| `LayerControls.tsx` | `showRapids` / `onToggleRapids` props; RAPIDS toggle button |
| `PlaybackControls.tsx` | (Minor) Replace `onSeek(val)` calls with `seekToLine(val)` if the parent passes it through; optionally display `totalDuration` in mm:ss next to the line counter |

---

## Constants Reference

```typescript
// Physics constants — define once at module top level
const CUT_SPEED_MM_PER_S   = 5500 / 60    // 91.667 mm/s  (G1 feed, 5500 mm/min)
const RAPID_SPEED_MM_PER_S = 18000 / 60   // 300 mm/s     (G0 rapid, 18000 mm/min)
const DWELL_DURATION_S     = 0.05          // non-geometry lines (headers, M-codes)
```

> **Tuning note:** `RAPID_SPEED_MM_PER_S` does not affect the geometry dot speed (the dot uses `CUT_SPEED_MM_PER_S` for visual clarity), but it *does* affect how fast the playhead advances through G0 lines in the duration table. Adjust to match the actual machine's rapid rate.