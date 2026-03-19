# CNC Playback & Physics Simulation

This document explains the technical implementation of the `usePlayback` hook, which provides a realistic, time-based simulation of the CNC machining process.

## 1. Goal
To provide a smooth, accurate visualization of the toolpath as calculated by the backend. The simulation needs to account for different speeds (G0 vs G1) and non-geometry lines (M-codes, tool changes) to synchronize exactly with the NC code.

## 2. Speed Constants
The hook defines fixed machine speeds (mm/sec) to translate physical path length into time:
- **`CUT_SPEED_MM_PER_S`**: Default 5500 mm/min (91.67 mm/s) for G1 (cutting) moves.
- **`RAPID_SPEED_MM_PER_S`**: Default 18,000 mm/min (300 mm/s) for G0 (rapid traverse) moves.
- **`DWELL_DURATION_S`**: A fixed 0.04s duration for header lines, M-codes, and tool change commands.

## 3. The Duration Table (`lineDurations`)
A `Float64Array` called `lineDurations` is built once the geometry loads:
1. **Initialise**: Every line starts with a `DWELL_DURATION_S`.
2. **Assign Cut Durations**: For every line with a `seq_index` mapping (from `lineToSegmentMap`), its duration is calculated as `segment_length / CUT_SPEED`.
3. **Assign Rapid Durations**: G0 moves don't have a backend `seq_index`, so the hook infers them by calculating the distance between the end of one segment and the start of the next. This time is assigned to any line containing "G0".

## 4. Cumulative Time and Seeking
A second array, `cumulativeTime`, is built by calculating the prefix-sum of `lineDurations`. This allows:
- **`totalDuration`**: The total simulation time (sum of all lines).
- **Seek-by-Time (O(1))**: `cumulativeTime[lineIndex]` gives the exact time a line should start.
- **Seek-by-Line (O(log N))**: `simTimeToLine(t)` uses binary search on `cumulativeTime` to find which line corresponds to a given timestamp.

## 5. The Animation Loop (`requestAnimationFrame`)
The simulation state is updated on every frame:
1. **Clock Tracking**: `wallClockRef` tracks real-world time elapsed since the last frame.
2. **Speed Multipliers**: `playbackSpeed` (for cutting) and `rapidPlaybackSpeed` (for G0 moves) are applied to the delta.
3. **Simulation Time Update**: `simTimeRef.current` advanced based on the speed-adjusted delta.
4. **State Sync**: `currentSimTime` and `currentLineIndex` (via binary search) are updated and exposed to the UI.

## 6. Frontend Visualization
Components like `GeometryViewer` and `NCPreview` use these values to:
- **Highlight the current line**: The NC code scrolls to the `currentLineIndex`.
- **Animate the machining dot**: `GeometryViewer` renders an SVG circle at the tool's current position, interpolating between the start and end points of the active segment based on `currentSimTime`.
