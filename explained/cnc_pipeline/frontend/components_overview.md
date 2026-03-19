# CNC Pipeline Components Overview

This document provides a brief description of each component found in the `c:\Users\badja\Documents\Projects_Developement\gamma\alugamma\src\features\cnc-pipeline\components` directory.

## 1. **`BackendStatus.tsx`**
A small, non-obtrusive component that shows a green or red dot indicating the backend machine's availability. It uses the `checkHealth` function from `api.ts`.

## 2. **`DXFDropZone.tsx`**
The initial upload area. It uses a drag-and-drop interface (or file picker) to accept `.dxf` files and triggers the `upload` function in `useGenerate`.

## 3. **`GeometryViewer.tsx`**
The core visualizer for the toolpath.
- **SVG-based Rendering**: Uses raw SVG coordinates to draw all path segments.
- **Layer Visibility**: Supports toggling individual DXF layers.
- **Machining Animation**: Uses `framer-motion` for a smoothly animating tool dot that follows the `currentLineIndex`.
- **Rapid Moves**: Infers and renders G0 "rapid traverse" moves between cutting segments (usually in red/dashed lines).

## 4. **`LayerControls.tsx`**
A UI panel (usually found in the preview header) that:
- Lists all detected CNC layers (CUT, FREZ, etc.).
- Provides checkboxes for visibility.
- Shows a "target" icon next to each layer to seek the playback directly to that layer's first segment.
- Includes a "Trace Mode" toggle for debugging.

## 5. **`NCPreview.tsx`**
A scrolling code viewer for the generated `.nc` program.
- **Line Highlighting**: Automatically scrolls to and highlights the `currentLineIndex` during playback.
- **Interaction**: Clicking a line of code triggers `seekToLine`, synchronizing the geometry viewer to that exact machining step.

## 6. **`PlaybackControls.tsx`**
A classic media-style control bar:
- **Play/Pause**: Toggles the `isPlaying` state.
- **Progress Slider**: Shows total duration and current simulation time.
- **Seek bar**: Allows scrubbing to any point in the NC program.

## 7. **`ScenarioCard.tsx`**
A summary card used when a DXF is first analyzed. It displays the detected machine scenario (e.g., "HOLES → FREZ → CUT") and tool assignments before the full NC code is generated.
