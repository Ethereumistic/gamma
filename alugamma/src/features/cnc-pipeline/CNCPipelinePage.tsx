// src/features/cnc-pipeline/CNCPipelinePage.tsx

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

import { BackendStatus } from "./components/BackendStatus"
import { DXFDropZone } from "./components/DXFDropZone"
import { LayerControls, LAYER_COLORS } from "./components/LayerControls"
import { GeometryViewer } from "./components/GeometryViewer"
import { NCPreview } from "./components/NCPreview"
import { useGenerate } from "./hooks/useGenerate"

const SCENARIO_LABELS: Record<string, string> = {
  most_common: "FREZ → CUT",
  common: "HOLES → FREZ → CUT",
  rare: "FREZ → FREZ_135 → CUT",
  very_rare: "HOLES → FREZ → FREZ_135 → CUT",
  cut_only: "CUT only",
}

const formatTime = (sec: number) => {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`
  return `${Math.round(sec)}s`
}

export default function CNCPipelinePage() {
  const { state, upload, generateNC, reset } = useGenerate()

  // Layer visibility — default all visible, updated when geometry loads
  const [visible, setVisible] = useState<Record<string, boolean>>({})

  // Portal tracking for sending elements to the app-navbar safely
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)

  useEffect(() => {
    // We attach a mutation observer to reliably locate the navbar portal target
    // in case it mounts slightly after the page component evaluates.
    const el = document.getElementById("cnc-navbar-portal")
    if (el) {
      setPortalNode(el)
    } else {
      const observer = new MutationObserver(() => {
        const node = document.getElementById("cnc-navbar-portal")
        if (node) {
          setPortalNode(node)
          observer.disconnect()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }
  }, [])

  const handleLayerToggle = (layer: string, value: boolean) => {
    setVisible((prev) => ({ ...prev, [layer]: value }))
  }

  // When geometry first loads, initialise all layers as visible
  const handleFile = async (file: File) => {
    setVisible({})  // reset visibility on new file
    await upload(file)
  }

  // Initialise visibility when geometry becomes available
  if (
    (state.status === "ready" || state.status === "done") &&
    state.geometry.layers.some((l) => !(l in visible))
  ) {
    const init: Record<string, boolean> = {}
    state.geometry.layers.forEach((l) => { init[l] = true })
    setVisible(init)
  }

  return (
    <div className="p-6 h-[calc(100vh-4rem)] flex flex-col text-slate-200">

      {/* ─── PORTAL: PUSH CONTROLS & ANALYSIS TO APP-NAVBAR ─── */}
      {portalNode && createPortal(
        <div className="flex items-center gap-3 w-full text-xs">
          <BackendStatus />

          {(state.status === "ready" || state.status === "done") ? (
            <>
              {/* Filename */}
              <span className="font-semibold text-slate-200 tracking-wide ml-1 truncate max-w-[200px]">
                {state.generate.filename}
              </span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />

              {/* Scenario */}
              <span className="flex items-center gap-1 font-medium whitespace-nowrap">
                {(SCENARIO_LABELS[state.generate.scenario] ?? state.generate.scenario).split(" ").map((word, i) => {
                  if (word === "→" || word === "only") return <span key={i} className="text-slate-500">{word}</span>
                  return <span key={i} style={{ color: LAYER_COLORS[word] ?? "#cbd5e1" }}>{word}</span>
                })}
              </span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />

              {/* Tools */}
              <span className="text-slate-400 whitespace-nowrap">
                Tools: <span className="text-slate-200 font-mono tracking-wider ml-1">T{state.generate.tools_used.join(" → T")}</span>
              </span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />

              {/* Stats */}
              <span className="text-slate-400 whitespace-nowrap">Contours: <span className="text-slate-200 font-medium ml-1">{state.generate.contour_count}</span></span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="text-slate-400 whitespace-nowrap">Lifts: <span className="text-slate-200 font-medium ml-1">{state.generate.lift_count}</span></span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="text-slate-400 whitespace-nowrap">Time: <span className="text-slate-200 font-medium ml-1">{formatTime(state.generate.estimated_time)}</span></span>

              {/* Actions */}
              <div className="ml-auto flex items-center gap-2 pl-4">
                <Button variant="ghost" size="sm" className="h-8 px-3 text-xs hover:bg-white/5 flex gap-1.5" onClick={reset}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Generate another
                </Button>
                {state.status === "ready" && (
                  <Button
                    size="sm"
                    className="h-8 px-4 text-xs shadow-[0_0_15px_rgba(20,180,100,0.15)] bg-emerald-600 hover:bg-emerald-500 text-white"
                    onClick={() => generateNC(state.jobId, state.generate, state.geometry)}
                  >
                    Generate NC program
                  </Button>
                )}
              </div>
            </>
          ) : (
            <span className="text-slate-300 font-medium tracking-wide ml-1">CNC Pipeline</span>
          )}
        </div>,
        portalNode
      )}

      {/* ─── PAGE CONTENT ─── */}

      {/* IDLE */}
      {state.status === "idle" && (
        <div className="flex-1 flex items-center justify-center">
          <DXFDropZone onFile={handleFile} />
        </div>
      )}

      {/* UPLOADING */}
      {state.status === "uploading" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400">Uploading and analysing DXF…</p>
        </div>
      )}

      {/* GENERATING */}
      {state.status === "generating" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400">Generating NC program…</p>
        </div>
      )}

      {/* ERROR */}
      {state.status === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          {/* @ts-ignore - Assuming message exists on error state */}
          <p className="text-red-400">{state.message}</p>
          <Button variant="outline" onClick={reset} className="border-white/10 hover:bg-white/10">Try again</Button>
        </div>
      )}

      {/* READY or DONE */}
      {(state.status === "ready" || state.status === "done") && (
        <div className="grid grid-cols-12 gap-6 h-full min-h-0">

          {/* LEFT COLUMN: NC Code Viewer */}
          <div className="col-span-3 h-full min-h-0">
            {state.status === "done" && (
              <NCPreview
                ncText={state.ncText}
                jobId={state.jobId}
              />
            )}
          </div>

          {/* RIGHT COLUMN: Geometry Viewer */}
          <div className="col-span-9 h-full min-h-0">
            <Card className="bg-transparent border-white/10 h-full flex flex-col shadow-none">
              <CardHeader className="py-2.5 px-4 border-b border-white/5 flex flex-row items-center justify-between space-y-0 shrink-0">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Geometry Preview</CardTitle>
                <LayerControls
                  layers={state.geometry.layers}
                  visible={visible}
                  onChange={handleLayerToggle}
                />
              </CardHeader>
              <CardContent className="flex-1 p-0 relative overflow-hidden min-h-0">
                <GeometryViewer
                  geometry={state.geometry}
                  visible={visible}
                />
              </CardContent>
            </Card>
          </div>

        </div>
      )}
    </div>
  )
}