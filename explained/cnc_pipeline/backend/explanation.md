# CNC Pipeline Backend Orchestration Explanation

This document provides a high-level overview of the `cnc-pipeline-backend` logic, specifically focusing on how `main.py` and `run_pipeline` orchestrate the conversion of DXF files into validated G-code.

## 1. System Overview
The backend is a **FastAPI** application designed to process DXF (Drawing Interchange Format) files and generate optimized G-code for CNC machinery. It handles geometry extraction, path optimization through various algorithms, tool sequencing based on machine scenarios, and G-code validation.

## 2. API Endpoints (`main.py`)
`main.py` serves as the entry point and orchestrator of the web service.

- **`POST /api/generate`**: The primary endpoint. It accepts a DXF file and an optional `algorithm` parameter. It executes the core pipeline, stores the result in-memory, and returns JSON containing:
  - Job metadata (scenario, layers, tools).
  - Performance stats (contour count, lift count, estimated time).
  - **Geometry data**: A flat list of segments for frontend SVG/Canvas rendering.
  - **Mapping**: A dictionary linking G-code line numbers to geometry segment indices for synchronized UI playback.
- **`GET /api/preview/{job_id}`**: Retrieves the raw NC (G-code) text for a specific job.
- **`GET /api/download/{job_id}`**: Serves the generated `.nc` file for download.
- **`POST /api/diagnose-layers`**: A diagnostic tool that reports every layer found in a DXF, its entity count, types, and sample coordinates.

## 3. The Orchestration Pipeline (`run_pipeline`)
The logic in `cnc_pipeline/pipeline.py` defines the sequential flow of data:

### Phase 1: DXF Reading & Scoping
- **`DXFReader`** parses the file using `ezdxf`.
- **`detect_scenario`** identifies the machine's task (e.g., `most_common` for basic cut/frez) based on which layers are present.
- **`Config`** maps these scenarios to specific tool numbers and processing orders (e.g., FREZ first with Tool 9, CUT second with Tool 7).

### Phase 2: Geometry Processing
For every active CNC layer defined in the scenario:
1. **Extraction**: `get_contours` extracts lines, arcs, and polylines into a unified `Contour` model.
2. **Simplification**: `simplify_contour` removes redundant points or merges tiny segments.
3. **Sorting (Optimization)**:
   - For **FREZ** (milling) layers: Uses a designated algorithm (e.g., `raptor`, `anchor`, `oracle`, `shapely`, `conman`, `juggler`) to determine the cutting order. This is critical for maintaining material stability (vacuum hold-down).
   - For other layers: Uses `sort_nearest_neighbour` to minimize "air time" (rapid moves).

### Phase 3: Move Generation & G-code Writing
- **`generate_toolpath`** converts the ordered contours into a sequence of `Move` objects (linear, rapid, retract).
- **`GCodeWriter`** translates these moves into standardized G-code. 
  - It maintains a **`line_to_segment_map`** which is crucial for the frontend's ability to highlight the exact line being "machined" during simulation.

### Phase 4: Validation & Metadata
- **`validate`** performs a final check on the generated NC text (bounding box checks, tool sequence verification).
- **Stats**: Calculates the total path length and provides a rough time estimation based on feed rates.

## 4. Key Algorithms for FREZ Sorting
The backend supports multiple strategies for sequencing milling paths, selectable via the `algorithm` parameter:
- **Raptor/Anchor**: Geometric-based sorting prioritizing specific anchor points.
- **Oracle**: More advanced sequencing logic for complex nested shapes.
- **Shapely**: Uses spatial analysis (convex hulls) to determine cutting order from "unbiased" geometry.
- **Conman/Juggler**: Newer strategies designed to handle "Vacuum Anchor" priorities (machining inner parts before releasing the outer shape).

## 5. Data Flow Summary
1. **Input**: `.dxf` file (via HTTP POST).
2. **Intermediate**: `Contour` objects → `Move` objects.
3. **Output**: `.nc` G-code string + `geometry_data` (JSON) for visualization.
