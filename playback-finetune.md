

# CNC Pipeline Playback UI/UX Enhancements

You are an expert full-stack developer. We need to upgrade our CNC simulation frontend with advanced playback features, using `motion` for smooth animations, and adding bi-directional synchronization between the visualizer and the code.

Please ensure the `motion` package is installed (`pnpm add motion`) and implement the following requirements:

## 1. Create a Reverse Map (Segment -> Line)
**Target File:** `src/features/cnc-pipeline/CNCPipelinePage.tsx` (or where your state is managed)

To allow clicking on a geometry segment to jump to the corresponding NC code line, we need a reverse map.
* Create a `useMemo` that reverses the `lineToSegmentMap` provided by the backend.
  ```typescript
  const segmentToLineMap = useMemo(() => {
    const map: Record<number, number> = {}
    if (!state.generate?.line_to_segment_map) return map
    Object.entries(state.generate.line_to_segment_map).forEach(([lineStr, seqStr]) => {
      // Find the FIRST line that references this segment
      const seq = Number(seqStr)
      const line = Number(lineStr)
      if (map[seq] === undefined || line < map[seq]) {
        map[seq] = line
      }
    })
    return map
  }, [state.generate?.line_to_segment_map])
  ```
* Pass this `segmentToLineMap`, along with an `onSeek` function (which updates the `currentLineIndex`), down to the `GeometryViewer` and `LayerControls`.

## 2. Upgrade Geometry Viewer (Animated Dot, Persistent Info, Click-to-Seek)
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

* **Import Motion:** `import { motion } from "motion/react"` (or `framer-motion` depending on the installed version).
* **Persistent Info Card:** * Update the logic so the info card displays data for the `activeSeqIndex` by default, but is temporarily overridden if `hoveredSeq` is not null.
  * `const displaySeq = hoveredSeq !== null ? hoveredSeq : activeSeqIndex`
  * Use `displaySeq` to render the segment info box in the top left, ensuring it's always visible during playback.
* **Click-to-Seek:**
  * Add an `onClick` handler to the `<line>` elements representing the segments.
  * When clicked, look up the segment's `seq_index` in the `segmentToLineMap`. If a corresponding NC line exists, call `onSeek(lineIndex)`.
* **Animated Machining Dot:**
  * Replace the pulsing `<circle>` with a `<motion.circle>`.
  * Find the active segment (`const activeSegment = segments.find(s => s.seq_index === activeSeqIndex)`).
  * Use `motion` to smoothly animate the `cx` and `cy` coordinates from the segment's start (`x1`, `y1`) to its end (`x2`, `y2`).
  * Example implementation snippet inside the `<g>` tag:
    ```tsx
    {activeSegment && (
      <motion.circle
        key="cutting-head-dot"
        initial={{ cx: activeSegment.x1, cy: activeSegment.y1 }}
        animate={{ cx: activeSegment.x2, cy: activeSegment.y2 }}
        transition={{ duration: 0.2, ease: "linear" }} // Adjust duration based on playback speed if desired
        r={viewW * 0.008}
        fill="#fbbf24"
        style={{ pointerEvents: "none" }}
      />
    )}
    ```

## 3. Layer Controls "Hop-to-Start" Feature
**Target File:** `src/features/cnc-pipeline/components/LayerControls.tsx`

* **Props Update:** Pass `geometrySegments` and `segmentToLineMap`, plus an `onSeek(line: number)` callback to this component.
* **UI/UX Addition:** We still want users to be able to toggle visibility via clicking the layer pill, but we need a way to "seek" to it. 
* **Implementation:** Modify the layer button. When a user double-clicks (or shift-clicks, or clicks a new small "target/play" icon next to the layer name), execute a function that:
  1. Finds the first segment in `geometrySegments` that matches the target `layer`.
  2. Looks up that segment's `seq_index` in the `segmentToLineMap`.
  3. Calls `onSeek(foundLineIndex)`.

## 4. Ensure Smooth NC Code Scrolling
**Target File:** `src/features/cnc-pipeline/components/NCPreview.tsx`

* Because the user can now click randomly on the geometry to jump around, ensure the `useEffect` that calls `.scrollIntoView({ behavior: 'auto', block: 'center' })` on the active line reference handles sudden large jumps cleanly without breaking the layout.


# Dynamic Duration Calculation for Machining Dot

You are an expert full-stack developer. Following up on the previous UI/UX enhancements, we need to ensure the animated machining dot moves at a constant, realistic rate regardless of segment length, factoring in the current playback speed.

Please implement the following logic in the `GeometryViewer` component.

## 1. Calculate Segment Distance & Duration
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

* We need to calculate the physical length of the active segment to determine how long the SVG animation should take.
* Define a base speed (e.g., `BASE_SPEED = 100` units per second) and modify it by the `playbackSpeed` prop (which you should pass down from `CNCPipelinePage`).

Add this logic inside the `GeometryViewer` component, right before the `return` statement:

```tsx
// Helper to calculate distance between two points
const getSegmentLength = (seg: { x1: number; y1: number; x2: number; y2: number }) => {
  return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)
}

// Pass playbackSpeed as a prop to GeometryViewer, default to 1
const activeSegment = activeSeqIndex !== null 
  ? segments.find(s => s.seq_index === activeSeqIndex) 
  : null

// Calculate dynamic duration based on segment length and playback speed
const BASE_SPEED_MM_PER_SEC = 150 // Adjust this to match a comfortable viewing speed at 1x
const dynamicDuration = activeSegment 
  ? getSegmentLength(activeSegment) / (BASE_SPEED_MM_PER_SEC * (playbackSpeed || 1))
  : 0
```

## 2. Apply the Dynamic Duration to the Motion Circle
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

* Update the `<motion.circle>` element to use the `dynamicDuration` calculated above. 
* Add `ease: "linear"` so the dot doesn't artificially accelerate/decelerate at the corners of a continuous toolpath.

```tsx
{/* Inside the <g> tag where the lines are rendered */}
{activeSegment && (
  <motion.circle
    key="cutting-head-dot"
    initial={{ cx: activeSegment.x1, cy: activeSegment.y1 }}
    animate={{ cx: activeSegment.x2, cy: activeSegment.y2 }}
    transition={{ 
      duration: Math.max(0.05, dynamicDuration), // Prevent 0 duration for tiny segments
      ease: "linear" 
    }}
    r={viewW * 0.008}
    fill="#fbbf24"
    style={{ pointerEvents: "none", zIndex: 50 }}
  />
)}

## 3. Ensure Props are Passed
**Target File:** `src/features/cnc-pipeline/CNCPipelinePage.tsx`

* Make sure `playbackSpeed` is extracted from the `usePlayback` hook and passed down to `<GeometryViewer playbackSpeed={playbackSpeed} ... />`.