import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { useWorkspace } from "@/features/workspace/context"
import { toast } from "sonner"
import JSZip from "jszip"
import { saveAs } from "file-saver"

import { DXFDropZone } from "@/features/cnc-pipeline/components/DXFDropZone"
import { BulkUploadPanel } from "@/features/cnc-pipeline/components/BulkUploadPanel"
import { CutDedupSettingsCard, type CutDedupSettings } from "@/features/cnc-pipeline/components/CutDedupSettingsCard"
import { CncToolPresetCard } from "@/features/cnc-pipeline/components/CncToolPresetCard"
import { useBulkGenerate } from "@/features/cnc-pipeline/hooks/useBulkGenerate"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const ALGORITHMS = [
  { value: "juggler_gemini", label: "Juggler G" },
  { value: "juggler_claude", label: "Juggler C" },
]

export default function CNCPipelineDashboardPage() {
  const { authenticated, selectedProjectId, selectedOrganizationId } =
    useWorkspace()
  const navigate = useNavigate()
  const saveNcProgram = useMutation(api.nc_programs.saveNcProgram)

  // Algorithm selection (persisted to localStorage)
  const [algorithm, setAlgorithm] = useState(
    () => localStorage.getItem("cnc_default_algorithm") || "juggler_gemini",
  )
  const [cutDedup, setCutDedup] = useState<CutDedupSettings>(() => {
    try {
      return {
        enabled: false,
        joinLines: true,
        tolerance: 0.01,
        ...JSON.parse(localStorage.getItem("cnc_cut_dedup_settings") || "{}"),
      }
    } catch {
      return { enabled: false, joinLines: true, tolerance: 0.01 }
    }
  })

  // Fetch org tool overrides
  const cncSettings = useQuery(
    api.cnc_settings.getByOrganization,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip",
  )
  const toolOverrides = cncSettings?.toolOverrides

  // Bulk state
  const { state: bulkState, addFiles, processQueue, saveAll, cancel, clear } =
    useBulkGenerate()

  // Auto-start processing when files are added
  useEffect(() => {
    if (
      bulkState.items.length > 0 &&
      !bulkState.isProcessing &&
      bulkState.items.some((i) => i.status === "pending")
    ) {
      processQueue(algorithm, toolOverrides, cutDedup)
    }
  }, [bulkState.items.length, bulkState.isProcessing, algorithm, toolOverrides, cutDedup, processQueue])

  // Guard: warn before navigating away during processing
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (bulkState.isProcessing) e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [bulkState.isProcessing])

  // Handle files dropped/selected
  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      addFiles(files)
    },
    [addFiles],
  )

  // Download all completed items as .ZIP
  const handleDownload = useCallback(() => {
    const zip = new JSZip()
    let count = 0

    for (const item of bulkState.items) {
      if (item.status === "done" && item.ncText) {
        zip.file(`${item.name}.nc`, item.ncText)
        count++
      }
    }

    if (count === 0) {
      toast.error("No completed programs to download")
      return
    }

    zip.generateAsync({ type: "blob" }).then((content) => {
      saveAs(
        content,
        `nc-programs-${new Date().toISOString().slice(0, 10)}.zip`,
      )
      toast.success(`Downloaded ${count} NC program${count > 1 ? "s" : ""}`)
    })
  }, [bulkState.items])

  // Save all completed items to Convex (one at a time)
  const handleSaveAll = useCallback(async () => {
    if (!selectedProjectId || !selectedOrganizationId) {
      toast.error("Select a project first")
      return
    }

    const doneItems = bulkState.items.filter(
      (i) =>
        i.status === "done" &&
        !i.convexId &&
        i.generate &&
        i.geometry &&
        i.ncText,
    )
    if (doneItems.length === 0) {
      toast.info("Nothing to save")
      return
    }

    toast.info(`Saving ${doneItems.length} programs to project...`)
    let savedCount = 0

    for (const item of doneItems) {
      try {
        const gen = item.generate!
        const geo = item.geometry!
        await saveNcProgram({
          projectId: selectedProjectId,
          organizationId: selectedOrganizationId,
          name: item.name,
          algorithm: gen.algorithm,
          scenario: gen.scenario,
          estimatedTimeSeconds: gen.estimated_time,
          ncCode: item.ncText!,
          dxfSourceName: item.file.name,
          geometryData: { segments: geo.segments, bbox: geo.bbox },
          lineToSegmentMap: gen.line_to_segment_map || undefined,
          contoursByLayer: gen.contours_by_layer || undefined,
          stockBbox: gen.stock_bbox || undefined,
        })
        savedCount++
      } catch (e: any) {
        console.error(`Failed to save ${item.name}:`, e)
      }
    }

    if (savedCount > 0) {
      toast.success(
        `Saved ${savedCount} program${savedCount > 1 ? "s" : ""} to project`,
      )
    } else {
      toast.error("Failed to save programs")
    }
  }, [bulkState.items, selectedProjectId, selectedOrganizationId, saveNcProgram])

  // Algorithm change handler
  const handleAlgorithmChange = (val: string) => {
    setAlgorithm(val)
    localStorage.setItem("cnc_default_algorithm", val)
  }

  const handleCutDedupChange = (next: CutDedupSettings) => {
    setCutDedup(next)
    localStorage.setItem("cnc_cut_dedup_settings", JSON.stringify(next))
  }

  if (!authenticated) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">CNC Pipeline</h1>
        <p className="text-slate-400">Please sign in to use the CNC pipeline.</p>
      </div>
    )
  }

  return (
    <div className="p-6 h-[calc(100vh-4rem)] overflow-y-auto">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white tracking-tight">
            CNC Batch Pipeline
          </h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/cnc-pipeline/new")}
            className="text-xs text-slate-400 hover:text-white"
          >
            Single file <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>

        {/* Algorithm selector */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Algorithm
          </span>
          <Select
            value={algorithm}
            onValueChange={handleAlgorithmChange}
            disabled={bulkState.isProcessing}
          >
            <SelectTrigger className="h-8 w-[160px] bg-black/20 border-white/10 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGORITHMS.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <CncToolPresetCard disabled={bulkState.isProcessing} />

        <CutDedupSettingsCard
          value={cutDedup}
          onChange={handleCutDedupChange}
          disabled={bulkState.isProcessing}
        />

        {/* DXF Drop Zone (multi-file) */}
        <DXFDropZone onFiles={handleFiles} multiple disabled={bulkState.isProcessing} />

        {/* Bulk Queue Panel */}
        <BulkUploadPanel
          state={bulkState}
          onCancel={cancel}
          onClear={clear}
          onDownload={handleDownload}
          onSaveAll={handleSaveAll}
          hasProject={!!selectedProjectId && !!selectedOrganizationId}
        />
      </div>
    </div>
  )
}