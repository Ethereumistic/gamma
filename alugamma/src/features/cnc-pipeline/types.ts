// src/features/cnc-pipeline/types.ts

export type Scenario =
  | "most_common"
  | "common"
  | "rare"
  | "very_rare"
  | "cut_only"

export interface GenerateResponse {
  job_id:           string
  filename:         string
  scenario:         Scenario
  layers_detected:  string[]
  tools_used:       number[]
  contour_count:    number
  lift_count:       number
  estimated_time:   number      // seconds
  warnings:         string[]
  algorithm:        string      // "raptor" | "anchor" | ...
  line_to_segment_map: Record<number, number>
}

export interface PreviewResponse {
  nc_text: string
}

// One segment = a straight line from point A to point B, belonging to a layer
export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
  layer: string
  // sequence index within the full cutting order (0-based)
  // set by the backend in the /api/geometry response
  seq_index: number
}

export interface GeometryResponse {
  segments:    Segment[]
  layers:      string[]           // all layer names present
  bbox: {
    min_x: number
    min_y: number
    max_x: number
    max_y: number
  }
}

// Page-level state machine
export type PageState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "ready"; jobId: string; generate: GenerateResponse; geometry: GeometryResponse }
  | { status: "generating" }
  | { status: "done"; jobId: string; generate: GenerateResponse; geometry: GeometryResponse; ncText: string }
  | { status: "error"; message: string }
