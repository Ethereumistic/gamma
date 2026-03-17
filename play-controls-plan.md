# CNC Pipeline Playback & Synchronization Implementation Guide

You are an expert full-stack developer. Your task is to implement a robust playback/simulation feature for our CNC DXF-to-NC-code pipeline. 

We have explicitly decided **NOT** to parse G-code on the frontend. Instead, the backend will act as the source of truth and generate a `line_to_segment_map` during the G-code writing phase.

Please implement the following changes across the Python backend and React frontend.

## 1. Backend: Data Enrichment & Mapping
**Target Files:** `models.py`, `toolpath.py`, `gcode_writer.py`, `pipeline.py`, `main.py`

To sync NC Code lines with visual toolpaths, the backend must map the generated text lines to the `seq_index` of the geometry.

* **Step 1: Update `Move` model (`models.py`)**
  Add an optional `seq_index: int | None = None` to the `Move` dataclass so individual moves can remember which DXF segment they belong to.

* **Step 2: Tag Moves in `toolpath.py`**
  Update `generate_toolpath` to accept the starting `seq_index` or handle it alongside the contours. As you loop over `contour.points` to generate cut moves, attach the corresponding `seq_index` to the `Move` object. (Remember that a contour with $N$ points has $N-1$ segments, matching the logic in `pipeline.py`).

* **Step 3: Track Line Numbers in `gcode_writer.py`**
  Modify `GCodeWriter.write()`. It should now return a tuple: `(nc_text: str, line_to_segment_map: dict[int, int])`.
  As you build the `lines` list, keep track of the current line index (0-based). When you write a `Move` that has a `seq_index`, record it: `line_to_segment_map[current_line_index] = m.seq_index`.

* **Step 4: Pass the map to the Frontend (`pipeline.py` & `main.py`)**
  Update `PipelineResult` to include `line_to_segment_map: dict[int, int]`. In `main.py`, include this map in the `/api/generate` JSON response.

## 2. Frontend: Geometry Viewer UI Tweaks
**Target File:** `src/features/cnc-pipeline/components/GeometryViewer.tsx`

* **Pitch Black Background:** Locate the `<svg>` element inside the `TransformComponent`. Change its inline style `backgroundColor: "rgba(0,0,0,0.2)"` to full pitch black: `backgroundColor: "#000000"`.
* **Disable Rubberband:** Update the `TransformWrapper` to disable panning outside the bounds or the elastic bounce effect (e.g., `limitToBounds={false}` or adjusting the panning props based on `react-zoom-pan-pinch` docs).

## 3. Frontend: State & Synchronization Hook
**Target File:** `src/features/cnc-pipeline/hooks/usePlayback.ts` (New)

Create a custom hook to manage playback state independent of the generation state:
* State: `isPlaying` (boolean), `currentLineIndex` (number), `playbackSpeed` (number), `activeLayers` (string array).
* Logic: A `useEffect` that uses `requestAnimationFrame` or `setInterval` to increment `currentLineIndex` based on `playbackSpeed` when `isPlaying` is true. Ensure it stops at the maximum line number.

## 4. Frontend: Layout & New Playback Component
**Target Files:** `CNCPipelinePage.tsx`, `PlaybackControls.tsx` (New)

* **Update Types:** In `types.ts`, add `line_to_segment_map: Record<number, number>` to `GenerateResponse`.
* **Layout Adjustment:** In `CNCPipelinePage.tsx`, wrap `NCPreview` in a `flex flex-col gap-4` container. Place the new `PlaybackControls` directly below it (`shrink-0`).
* **Create `PlaybackControls.tsx`:** Build a new component using `shadcn/ui`.
    * **Controls:** Play/Pause, Step Backward, Step Forward using `lucide-react`.
    * **Timeline:** A `<Slider>` to scrub through the timeline (min=0, max=total lines).
    * **Speed:** A `<Slider>` or `<Select>` for playback speed.
    * **Layer Filtering:** Toggle buttons mapping to the `activeLayers` state to turn specific toolpaths (like "FREZ" or "HOLES") on and off.

## 5. Frontend: Tying it together (Visual Sync)
**Target Files:** `NCPreview.tsx`, `GeometryViewer.tsx`

* **Syncing NCPreview:** * Accept `currentLineIndex`. 
    * Highlight the active line of code (e.g., `bg-emerald-500/20 text-emerald-300`).
    * Use a `React.useRef` and `.scrollIntoView({ block: 'center' })` to ensure the highlighted line stays in the visible area of the `<ScrollArea>`.
* **Syncing GeometryViewer:**
    * Accept `currentLineIndex` and the `line_to_segment_map`.
    * Derive the `activeSeqIndex` from the map.
    * Visually differentiate segments: 
        * Hide segments belonging to layers filtered out by `activeLayers`.
        * The `activeSeqIndex` segment should be heavily highlighted.
        * Segments with a `seq_index < activeSeqIndex` should appear "cut" (solid).
        * Segments with a `seq_index > activeSeqIndex` should appear dimmed.