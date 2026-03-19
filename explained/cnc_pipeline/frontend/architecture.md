# CNC Pipeline Frontend Architecture

This document describes the high-level architecture of the CNC Pipeline feature in the AluGamma frontend.

## 1. Core State Management
The feature follows a **state-machine pattern** via the `useGenerate` hook. The `PageState` type (defined in `types.ts`) governs what is displayed on the screen.

### State Flow:
1. **`idle`**: The initial state. Shows the `DXFDropZone` for file uploads.
2. **`uploading`**: Triggered when a file is dropped. The frontend sends the DXF to the backend for analysis.
3. **`ready`**: The backend has processed the DXF and returned a `job_id`, basic metadata, and `geometry_data`. The UI shows a preview of the geometry.
4. **`generating`**: Triggered when the user clicks "Generate NC program". The frontend fetches the final NC code from the backend.
5. **`done`**: The NC code is received and now the playback controls, NC code viewer, and simulation dot are active.
6. **`error`**: A terminal state reached if any network or processing error occurs.

## 2. API Communication (`api.ts`)
The frontend communicates with the backend via standard REST calls:
- **`POST /api/generate?algorithm=...`**: Uploads the DXF and returns initial analysis + geometry.
- **`GET /api/preview/{jobId}`**: Fetches the generated NC text once requested.
- **`GET /api/download/{jobId}`**: Used to generate direct download links for the final `.nc` file.
- **`GET /api/health`**: Periodically checks if the backend is reachable.

## 3. Data Synchronization
A critical feature is the synchronization between **NC Code** and **Geometry Segments**. This is achieved through two data structures returned by the backend:
- **`segments` (GeometryResponse)**: A list of line segments with coordinates, layer labels, and a `seq_index`.
- **`line_to_segment_map` (GenerateResponse)**: A mapping where keys are NC code line numbers and values are the corresponding `seq_index`.

This mapping allows the `usePlayback` hook to identify exactly which geometry segment is being "machined" at any given line of code.

## 4. Key Hooks
- **`useGenerate.ts`**: Handles the API state machine described above.
- **`usePlayback.ts`**: A time-based simulation engine using `requestAnimationFrame`. It calculates "physics-based" durations for G-code lines (G0 vs G1 speeds) to provide a realistic toolpath animation.
