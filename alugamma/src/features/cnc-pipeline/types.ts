// src/features/cnc-pipeline/types.ts

import type { Id } from "../../../convex/_generated/dataModel";

export type Scenario =
  | "most_common"
  | "common"
  | "rare"
  | "very_rare"
  | "cut_only"

/** Serializable form sent to backend: array of [layer, toolNumber] pairs (legacy) */
export type CustomSequence = [string, number][]

/** New id-based sequence: array of [layer, toolId] pairs */
export type IdSequence = [string, string][]

export interface ContoursPoint {
  x: number
  y: number
}

export interface StoredContour {
  points: ContoursPoint[]
  is_closed: boolean
}

export interface StockBbox {
  min_x: number
  max_x: number
  min_y: number
  max_y: number
}

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
  contours_by_layer: Record<string, StoredContour[]>
  stock_bbox: StockBbox
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

export interface RegenerateResponse {
  job_id: string
  scenario: string
  algorithm: string
  geometry_data: GeometryResponse
  line_to_segment_map: Record<number, number>
  estimated_time: number
  nc_text: string
  contours_by_layer: Record<string, StoredContour[]>
  stock_bbox: StockBbox
  tools_used: number[]
  lift_count: number
}

// Summary shape returned by the listByProject query (used in sidebar)
export interface NcProgramSummary {
  _id: Id<"nc_programs">;
  name: string;
  algorithm: string;
  scenario: string;
  isStarred: boolean;
  updatedAt: number;
  createdAt: number;
}

// Page-level state machine
export type PageState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "ready"; jobId: string; generate: GenerateResponse; geometry: GeometryResponse }
  | { status: "generating"; jobId: string; generate: GenerateResponse; geometry: GeometryResponse }
  | { status: "done"; jobId: string; generate: GenerateResponse; geometry: GeometryResponse; ncText: string }
  | { status: "error"; message: string }
