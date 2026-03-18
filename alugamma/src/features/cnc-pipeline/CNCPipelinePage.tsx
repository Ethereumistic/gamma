// src/features/cnc-pipeline/CNCPipelinePage.tsx

import { useState, useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RefreshCw } from "lucide-react"

import { BackendStatus } from "./components/BackendStatus"
import { DXFDropZone } from "./components/DXFDropZone"
import { LayerControls, LAYER_COLORS } from "./components/LayerControls"
import { GeometryViewer } from "./components/GeometryViewer"
import { NCPreview } from "./components/NCPreview"
import { PlaybackControls } from "./components/PlaybackControls"
import { useGenerate } from "./hooks/useGenerate"
import { usePlayback } from "./hooks/usePlayback"

const SCENARIO_LABELS: Record<string, string> = {
  most_common: "FREZ → CUT",
  common: "HOLES → FREZ → CUT",
  rare: "FREZ → FREZ_135 → CUT",
  very_rare: "HOLES → FREZ → FREZ_135 → CUT",
  cut_only: "CUT only",
}

const ALGORITHMS: { value: string; label: string; desc: string }[] = [
  { value: "raptor", label: "v0.4 Raptor", desc: "Polar clockwise sweep with ring clustering" },
  { value: "anchor", label: "v0.5 Anchor", desc: "Vacuum anchor preservation priority" },
  { value: "oracle", label: "v1.0 Oracle", desc: "AI-powered optimal path selection" },
]

const formatTime = (sec: number) => {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`
  return `${Math.round(sec)}s`
}

export default function CNCPipelinePage() {
  const { state, upload, generateNC, reset } = useGenerate()

  const [algorithm, setAlgorithm] = useState("raptor")
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [showRapids, setShowRapids] = useState(true)
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)

  const [traceMode, setTraceMode] = useState<Record<string, boolean>>({
    HOLES: false,
    FREZ: false,
    FREZ_135: false,
    CUT: false,
    RAPIDS: false,
  })

  const handleTraceModeToggle = (layer: string) => {
    setTraceMode(prev => ({ ...prev, [layer]: !prev[layer] }))
  }

  // ── NC lines — only available in "done" state ─────────────────────────────
  const ncLines = useMemo(
    () => (state.status === "done" ? state.ncText.split("\n") : []),
    [state]
  )

  // ── Segments and lineToSegmentMap — available in both "ready" and "done" ──
  const segments = (state.status === "ready" || state.status === "done")
    ? state.geometry.segments
    : []

  const lineToSegmentMap = (state.status === "ready" || state.status === "done")
    ? state.generate.line_to_segment_map
    : {}

  // ── Playback hook — time-based ────────────────────────────────────────────
  const {
    isPlaying,
    setIsPlaying,
    currentLineIndex,
    setCurrentLineIndex,
    seekToLine,
    seekTrigger,
    playbackSpeed,
    setPlaybackSpeed,
    rapidPlaybackSpeed,
    setRapidPlaybackSpeed,
    totalDuration,
    currentSimTime,
  } = usePlayback(ncLines, segments, lineToSegmentMap)

  // ── Reverse map: seq_index → first G-code line number ────────────────────
  const segmentToLineMap = useMemo(() => {
    if (state.status !== "done" || !state.generate.line_to_segment_map) return {}
    const map: Record<number, number> = {}
    Object.entries(state.generate.line_to_segment_map).forEach(([lineStr, seqStr]) => {
      const seq = Number(seqStr)
      const line = Number(lineStr)
      if (map[seq] === undefined || line < map[seq]) {
        map[seq] = line
      }
    })
    return map
  }, [state])

  // ── Portal to app-navbar ──────────────────────────────────────────────────
  useEffect(() => {
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

  const handleFile = async (file: File) => {
    setVisible({})
    await upload(file, algorithm)
  }

  // Initialise layer visibility when geometry loads
  if (
    (state.status === "ready" || state.status === "done") &&
    state.geometry.layers.some((l) => !(l in visible))
  ) {
    const init: Record<string, boolean> = {}
    state.geometry.layers.forEach((l) => { init[l] = true })
    setVisible(init)
  }

  const activeAlgoLabel = ALGORITHMS.find(
    (a) => a.value === ((state.status === "ready" || state.status === "done")
      ? state.generate.algorithm
      : algorithm)
  )?.label ?? algorithm

  return (
    <div className="p-6 h-[calc(100vh-4rem)] flex flex-col text-slate-200">

      {/* ─── PORTAL: PUSH CONTROLS & ANALYSIS TO APP-NAVBAR ─── */}
      {portalNode && createPortal(
        <div className="flex items-center gap-3 w-full text-xs">
          <BackendStatus />

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              Algorithm
            </span>
            <Select
              value={algorithm}
              onValueChange={setAlgorithm}
              disabled={state.status === "uploading" || state.status === "generating"}
            >
              <SelectTrigger
                id="cnc-algo-select"
                className="h-7 w-[130px] bg-black/20 border-white/10 text-xs font-medium hover:bg-white/5 focus:ring-1 focus:ring-emerald-500"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALGORITHMS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    <div className="flex flex-col">
                      <span className="font-medium">{a.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(state.status === "ready" || state.status === "done") ? (
            <>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="font-semibold text-slate-200 tracking-wide truncate max-w-[200px]">
                {state.generate.filename}
              </span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-500/20 whitespace-nowrap shrink-0">
                {activeAlgoLabel}
              </span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="flex items-center gap-1 font-medium whitespace-nowrap">
                {(SCENARIO_LABELS[state.generate.scenario] ?? state.generate.scenario).split(" ").map((word, i) => {
                  if (word === "→" || word === "only") return <span key={i} className="text-slate-500">{word}</span>
                  return <span key={i} style={{ color: LAYER_COLORS[word] ?? "#cbd5e1" }}>{word}</span>
                })}
              </span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="text-slate-400 whitespace-nowrap">
                Tools: <span className="text-slate-200 font-mono tracking-wider ml-1">T{state.generate.tools_used.join(" → T")}</span>
              </span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="text-slate-400 whitespace-nowrap">Contours: <span className="text-slate-200 font-medium ml-1">{state.generate.contour_count}</span></span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="text-slate-400 whitespace-nowrap">Lifts: <span className="text-slate-200 font-medium ml-1">{state.generate.lift_count}</span></span>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <span className="text-slate-400 whitespace-nowrap">
                Time:{" "}
                <span className="text-slate-200 font-medium ml-1">
                  {state.status === "done" && totalDuration > 0
                    ? formatTime(totalDuration)
                    : formatTime(state.generate.estimated_time)}
                </span>
              </span>

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

      {state.status === "idle" && (
        <div className="flex-1 flex items-center justify-center">
          <DXFDropZone onFile={handleFile} />
        </div>
      )}

      {state.status === "uploading" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400">Uploading and analysing DXF…</p>
        </div>
      )}

      {state.status === "generating" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400">Generating NC program…</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          {/* @ts-ignore */}
          <p className="text-red-400">{state.message}</p>
          <Button variant="outline" onClick={reset} className="border-white/10 hover:bg-white/10">Try again</Button>
        </div>
      )}

      {(state.status === "ready" || state.status === "done") && (
        <div className="grid grid-cols-12 gap-6 h-full min-h-0">

          {/* LEFT: NC Code Viewer */}
          <div className="col-span-3 h-full min-h-0">
            {state.status === "done" && (
              <NCPreview
                ncText={state.ncText}
                jobId={state.jobId}
                currentLineIndex={currentLineIndex}
                onLineClick={seekToLine}
              />
            )}
          </div>

          {/* RIGHT: Geometry Viewer */}
          <div className="col-span-9 h-full min-h-0">
            <Card className="bg-transparent border-white/10 h-full flex flex-col shadow-none">
              <CardHeader className="py-2 px-4 border-b border-white/5 flex flex-row items-center gap-6 justify-between shrink-0 h-14 space-y-0">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-2">
                    Preview
                  </span>

                  {state.status === "done" && (
                    <>
                      <div className="flex items-center gap-3 border-l border-white/10 pl-4 shrink-0">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground/60 w-12">Cut Spd</span>
                        <Slider
                          value={[playbackSpeed]}
                          min={0.5} max={10} step={0.1}
                          onValueChange={(val) => setPlaybackSpeed(val[0])}
                          className="w-20"
                        />
                        <span className="text-[10px] font-mono text-emerald-400 tabular-nums w-8">
                          {playbackSpeed.toFixed(1)}x
                        </span>
                      </div>
                      <div className="flex items-center gap-3 border-l border-white/10 pl-4 shrink-0">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground/60 text-red-400 w-16">Rapid Spd</span>
                        <Slider
                          value={[rapidPlaybackSpeed]}
                          min={0.5} max={10} step={0.1}
                          onValueChange={(val) => setRapidPlaybackSpeed(val[0])}
                          className="w-20"
                        />
                        <span className="text-[10px] font-mono text-red-400 tabular-nums w-8">
                          {rapidPlaybackSpeed.toFixed(1)}x
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center min-w-0 flex-1 justify-end">
                  <div className="overflow-x-auto no-scrollbar py-1">
                    <LayerControls
                      layers={state.geometry.layers}
                      visible={visible}
                      onChange={handleLayerToggle}
                      geometrySegments={state.geometry.segments}
                      segmentToLineMap={segmentToLineMap}
                      onSeek={seekToLine}
                      showRapids={showRapids}
                      onToggleRapids={setShowRapids}
                      traceMode={traceMode}
                      onTraceModeToggle={handleTraceModeToggle}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-0 relative overflow-hidden min-h-0">
                <GeometryViewer
                  geometry={state.geometry}
                  visible={visible}
                  showRapids={showRapids}
                  currentLineIndex={state.status === "done" ? currentLineIndex : undefined}
                  lineToSegmentMap={state.status === "done" ? state.generate.line_to_segment_map : undefined}
                  segmentToLineMap={segmentToLineMap}
                  onSeek={seekToLine}
                  playbackSpeed={playbackSpeed}
                  rapidSpeedMultiplier={rapidPlaybackSpeed}
                  seekTrigger={seekTrigger}
                  ncLines={state.status === "done" ? ncLines : undefined}
                  isPlaying={isPlaying}
                  traceMode={traceMode}
                />
              </CardContent>
              {state.status === "done" && (
                <div className="h-12 border-t border-white/5 px-4 flex items-center shrink-0 bg-black/20">
                  <PlaybackControls
                    isPlaying={isPlaying}
                    onTogglePlay={() => setIsPlaying(!isPlaying)}
                    currentLine={currentLineIndex}
                    totalLines={ncLines.length}
                    onSeek={seekToLine}
                    totalDuration={totalDuration}
                    currentSimTime={currentSimTime}
                  />
                </div>
              )}
            </Card>
          </div>

        </div>
      )}
    </div>
  )
}