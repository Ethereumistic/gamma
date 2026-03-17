# CNC Simulator: Rapid Moves & Continuous Tool Animation

**Context:**
You are working on a React + Vite frontend for a CNC DXF-to-NC-code pipeline. We have a `<GeometryViewer>` component that renders 2D toolpaths using SVG and animates a cutting tool dot using `motion/react` (Framer Motion). 
Currently, the backend sends an array of `segments` (the actual cutting moves). The frontend uses a `lineToSegmentMap` to sync the current G-code line to an `activeSeqIndex` (the segment currently being cut).

**The Problem:**
1. We are only visualizing the "cut" segments. When the machine retracts and performs a "rapid" traverse move (G0) to the next contour, there is no visual line.
2. Because the animated yellow dot only renders and animates when a cut segment is active, it disappears/flickers during rapid moves, resulting in a choppy animation (especially on layers with many plunges like `FREZ`).

**Your Task:**
Please implement a frontend-only solution to visualize rapid moves and make the tool dot animation continuous.

## Step 1: Derive Rapid Segments (Frontend Inference)
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

We do not need to change the backend. We can infer rapid moves by finding the gaps between contiguous cutting segments.
* Inside `GeometryViewer`, create a `useMemo` that sorts the active/visible `segments` by `seq_index`.
* Iterate through the sorted segments. Whenever the end point `(x2, y2)` of `segment[i]` does not match the start point `(x1, y1)` of `segment[i+1]`, generate a "rapid" segment bridging them.
* Store these in a `rapidSegments` array.

```typescript
// Example inference logic
const rapidSegments = useMemo(() => {
  const rapids = [];
  const sorted = [...visibleSegments].sort((a, b) => a.seq_index - b.seq_index);
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    // If distance is greater than a tiny tolerance, it's a rapid move
    if (Math.hypot(next.x1 - curr.x2, next.y1 - curr.y2) > 0.001) {
      rapids.push({
        id: `rapid-${curr.seq_index}-${next.seq_index}`,
        x1: curr.x2, y1: curr.y2, x2: next.x1, y2: next.y1,
        fromSeq: curr.seq_index, toSeq: next.seq_index
      });
    }
  }
  return rapids;
}, [visibleSegments]);
```

## Step 2: Render the Rapid Layer
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

* Inside the `<g>` tag of the SVG, map over `rapidSegments` and render them.
* Use a distinct style: `stroke="red"` (or `#ef4444`), `strokeDasharray="4 4"`, and lower opacity (e.g., `0.5`).
* Make sure they render *below* the cutting segments but *above* the reference layers.

*(Bonus: If you want to be thorough, add a "RAPIDS" toggle to `LayerControls.tsx` and pass its state down so the user can hide them).*

## Step 3: Fix the Machining Dot Animation
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

Currently, the dot uses `initial={{ cx: activeSegment.x1, ... }}` and only mounts when `activeSegment` exists. This causes teleportation and flickering.
* **Continuous Target State:** Create a derived state for the dot's target `cx` and `cy`.
  * If `activeSegment` exists, the dot should animate to `activeSegment.x2`, `activeSegment.y2`.
  * If the tool is currently on a rapid move (i.e., `activeSeqIndex` is null or transitioning), the dot must not unmount. It should hold its last known position or smoothly animate across the rapid segment.
* **Remove Conditional Rendering:** Render the `<motion.circle>` unconditionally as long as the simulation has started. 
* **Remove `initial`:** Do not use the `initial` prop for the coordinates, as Framer Motion will automatically interpolate from the current position to the new `animate` position. 
* Ensure the transition `duration` accounts for whether it is cutting (slower) or doing a rapid move (faster).

```tsx
// Conceptual implementation for the dot
<motion.circle
  animate={{ cx: targetX, cy: targetY }}
  transition={{ 
    duration: dynamicDuration, 
    ease: "linear" 
  }}
  r={viewW * 0.008}
  fill="#fbbf24"
/>
```
