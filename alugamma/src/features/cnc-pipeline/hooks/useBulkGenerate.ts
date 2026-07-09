import { useState, useCallback, useRef } from "react"
import { uploadDXF, fetchNCText, type CutDedupOptions } from "../api"
import type { GenerateResponse, GeometryResponse } from "../types"

export type BulkItemStatus =
  | "pending"
  | "uploading"
  | "generating"
  | "saving"
  | "done"
  | "error"

export interface BulkQueueItem {
  id: string
  file: File
  name: string // file.name without .dxf extension — used as NC filename
  status: BulkItemStatus
  error?: string
  ncText?: string // generated NC code (available when status is "done")
  generate?: GenerateResponse // stored when generation succeeds
  geometry?: GeometryResponse // stored when generation succeeds
  convexId?: string // ID of saved NC program (after optional save step)
}

export interface BulkState {
  items: BulkQueueItem[]
  isProcessing: boolean
  completedCount: number
  errorCount: number
  totalCount: number
}

const INITIAL_STATE: BulkState = {
  items: [],
  isProcessing: false,
  completedCount: 0,
  errorCount: 0,
  totalCount: 0,
}

export function useBulkGenerate() {
  const [state, setState] = useState<BulkState>(INITIAL_STATE)
  const abortRef = useRef(false)
  const itemsRef = useRef<BulkQueueItem[]>([])

  const addFiles = useCallback((files: File[]) => {
    const newItems: BulkQueueItem[] = files
      .filter((f) => f.name.toLowerCase().endsWith(".dxf"))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name.replace(/\.dxf$/i, ""),
        status: "pending" as BulkItemStatus,
      }))

    if (newItems.length === 0) return

    setState((prev) => {
      const updated = [...prev.items, ...newItems]
      itemsRef.current = updated
      return {
        items: updated,
        isProcessing: prev.isProcessing,
        completedCount: updated.filter((i) => i.status === "done").length,
        errorCount: updated.filter((i) => i.status === "error").length,
        totalCount: updated.length,
      }
    })
  }, [])

  const processQueue = useCallback(
    async (algorithm: string, toolOverrides?: Record<string, any>, cutDedup?: CutDedupOptions) => {
      abortRef.current = false
      setState((prev) => ({ ...prev, isProcessing: true }))

      // Process all pending items sequentially
      // Read from ref to get latest state
      const pending = itemsRef.current.filter((i) => i.status === "pending")

      for (const item of pending) {
        if (abortRef.current) break

        // Set status helper
        const setItemStatus = (id: string, patch: Partial<BulkQueueItem>) => {
          setState((prev) => {
            const items = prev.items.map((i) =>
              i.id === id ? { ...i, ...patch } : i,
            )
            itemsRef.current = items
            return {
              ...prev,
              items,
              completedCount: items.filter((i) => i.status === "done").length,
              errorCount: items.filter((i) => i.status === "error").length,
            }
          })
        }

        try {
          // Step 1: Upload DXF → backend runs pipeline, returns geometry + metadata
          setItemStatus(item.id, { status: "uploading" })
          const { generate, geometry } = await uploadDXF(
            item.file,
            algorithm,
            toolOverrides,
            undefined,
            cutDedup,
          )

          // Step 2: Fetch the generated NC text from the backend's in-memory store
          setItemStatus(item.id, { status: "generating" })
          const ncText = await fetchNCText(generate.job_id)

          // Done — NC text is now in memory, ready for download or save
          setItemStatus(item.id, {
            status: "done",
            ncText,
            generate,
            geometry,
          })
        } catch (e: any) {
          setItemStatus(item.id, {
            status: "error",
            error: e.message || "Unknown error",
          })
        }
      }

      setState((prev) => ({ ...prev, isProcessing: false }))
    },
    [],
  )

  // Save all completed items to Convex, one at a time
  const saveAll = useCallback(
    async (
      saveNcProgram: (args: any) => Promise<any>,
      projectId: string,
      organizationId: string,
    ) => {
      const doneItems = itemsRef.current.filter(
        (i) => i.status === "done" && !i.convexId,
      )

      for (const item of doneItems) {
        if (!item.generate || !item.geometry || !item.ncText) continue

        try {
          setState((prev) => {
            const items = prev.items.map((i) =>
              i.id === item.id
                ? { ...i, status: "saving" as BulkItemStatus }
                : i,
            )
            itemsRef.current = items
            return { ...prev, items }
          })

          const gen = item.generate
          const geo = item.geometry
          const convexId = await saveNcProgram({
            projectId,
            organizationId,
            name: item.name,
            algorithm: gen.algorithm,
            scenario: gen.scenario,
            estimatedTimeSeconds: gen.estimated_time,
            ncCode: item.ncText,
            dxfSourceName: item.file.name,
            geometryData: {
              segments: geo.segments,
              bbox: geo.bbox,
            },
            lineToSegmentMap: gen.line_to_segment_map || undefined,
            contoursByLayer: gen.contours_by_layer || undefined,
            stockBbox: gen.stock_bbox || undefined,
          })

          setState((prev) => {
            const items = prev.items.map((i) =>
              i.id === item.id
                ? { ...i, status: "done" as BulkItemStatus, convexId }
                : i,
            )
            itemsRef.current = items
            return { ...prev, items }
          })
        } catch (e: any) {
          setState((prev) => {
            const items = prev.items.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: "error" as BulkItemStatus,
                    error: `Save failed: ${e.message}`,
                  }
                : i,
            )
            itemsRef.current = items
            return { ...prev, items }
          })
        }
      }
    },
    [],
  )

  const cancel = useCallback(() => {
    abortRef.current = true
    setState((prev) => {
      const items = prev.items.map((item) =>
        item.status === "pending" ||
        item.status === "uploading" ||
        item.status === "generating"
          ? { ...item, status: "error" as BulkItemStatus, error: "Cancelled" }
          : item,
      )
      itemsRef.current = items
      return {
        ...prev,
        items,
        isProcessing: false,
        completedCount: items.filter((i) => i.status === "done").length,
        errorCount: items.filter((i) => i.status === "error").length,
      }
    })
  }, [])

  const clear = useCallback(() => {
    itemsRef.current = []
    setState(INITIAL_STATE)
  }, [])

  return { state, addFiles, processQueue, saveAll, cancel, clear }
}