// src/features/cnc-pipeline/CNCPipelinePage.tsx

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

import { BackendStatus }   from "./components/BackendStatus"
import { DXFDropZone }     from "./components/DXFDropZone"
import { ScenarioCard }    from "./components/ScenarioCard"
import { LayerControls }   from "./components/LayerControls"
import { GeometryViewer }  from "./components/GeometryViewer"
import { NCPreview }       from "./components/NCPreview"
import { useGenerate }     from "./hooks/useGenerate"

export default function CNCPipelinePage() {
  const { state, upload, generateNC, reset } = useGenerate()

  // Layer visibility — default all visible, updated when geometry loads
  const [visible, setVisible] = useState<Record<string, boolean>>({})

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
    <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }} className="text-slate-200">

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }} className="text-white">CNC Pipeline</h1>
        <BackendStatus />
      </div>

      <Separator className="bg-white/10" />

      {/* IDLE — show drop zone */}
      {state.status === "idle" && (
        <DXFDropZone onFile={handleFile} />
      )}

      {/* UPLOADING */}
      {state.status === "uploading" && (
        <p className="text-slate-400">Uploading and analysing DXF…</p>
      )}

      {/* ERROR */}
      {state.status === "error" && (
        <div>
          <p style={{ color: "red" }} className="mb-4">{state.message}</p>
          <Button variant="outline" onClick={reset} className="border-white/10 hover:bg-white/10">Try again</Button>
        </div>
      )}

      {/* READY or DONE — show analysis + viewer + optionally NC */}
      {(state.status === "ready" || state.status === "done") && (
        <>
          {/* Analysis card */}
          <ScenarioCard data={state.generate} />

          {/* Layer controls */}
          <Card className="bg-transparent border-white/10">
            <CardHeader><CardTitle>Layers</CardTitle></CardHeader>
            <CardContent>
              <LayerControls
                layers={state.geometry.layers}
                visible={visible}
                onChange={handleLayerToggle}
              />
            </CardContent>
          </Card>

          {/* Geometry viewer */}
          <Card className="bg-transparent border-white/10">
            <CardHeader><CardTitle>Geometry preview</CardTitle></CardHeader>
            <CardContent style={{ height: 500 }}>
              <GeometryViewer
                geometry={state.geometry}
                visible={visible}
              />
            </CardContent>
          </Card>

          {/* Generate NC button — only in ready state */}
          {state.status === "ready" && (
            <div>
              <Button
                onClick={() => generateNC(state.jobId, state.generate, state.geometry)}
              >
                Generate NC program
              </Button>
            </div>
          )}

          {/* GENERATING */}
          {state.status === "generating" && (
            <p className="text-slate-400">Generating NC program…</p>
          )}

          {/* NC output */}
          {state.status === "done" && (
            <Card className="bg-transparent border-white/10">
              <CardHeader><CardTitle>NC Program</CardTitle></CardHeader>
              <CardContent>
                <NCPreview
                  ncText={state.ncText}
                  jobId={state.jobId}
                  onReset={reset}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
