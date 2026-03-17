// src/features/cnc-pipeline/api.ts

import type { GenerateResponse, GeometryResponse, PreviewResponse } from "./types"

const BASE = import.meta.env.VITE_CNC_API_URL || "https://cnc.alubeta.com"

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, {
      signal: AbortSignal.timeout(2000), // [cite: 1]
    })
    return res.ok // [cite: 1]
  } catch {
    return false // [cite: 1]
  }
}

// Upload DXF → get job_id + analysis + geometry in one shot
export async function uploadDXF(file: File): Promise<{
  generate: GenerateResponse
  geometry: GeometryResponse
}> {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`${BASE}/api/generate`, { method: "POST", body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Upload failed")
  }
  return res.json()
}

export async function fetchNCText(jobId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/preview/${jobId}`)
  if (!res.ok) throw new Error("Preview fetch failed")
  const data: PreviewResponse = await res.json()
  return data.nc_text
}

export function downloadURL(jobId: string): string {
  return `${BASE}/api/download/${jobId}`
}
