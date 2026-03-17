// src/features/cnc-pipeline/hooks/useGenerate.ts

import { useState, useCallback } from "react"
import { uploadDXF, fetchNCText } from "../api"
import type { PageState, GenerateResponse, GeometryResponse } from "../types"

export function useGenerate() {
  const [state, setState] = useState<PageState>({ status: "idle" })

  const upload = useCallback(async (file: File, algorithm: string = "raptor") => {
    setState({ status: "uploading" })
    try {
      const { generate, geometry } = await uploadDXF(file, algorithm)
      setState({ status: "ready", jobId: generate.job_id, generate, geometry })
    } catch (e: any) {
      setState({ status: "error", message: e.message })
    }
  }, [])

  const generateNC = useCallback(async (jobId: string, generate: GenerateResponse, geometry: GeometryResponse) => {
    setState({ status: "generating" })
    try {
      const ncText = await fetchNCText(jobId)
      setState({ status: "done", jobId, generate, geometry, ncText })
    } catch (e: any) {
      setState({ status: "error", message: e.message })
    }
  }, [])

  const reset = useCallback(() => {
    setState({ status: "idle" })
  }, [])

  return { state, upload, generateNC, reset }
}
