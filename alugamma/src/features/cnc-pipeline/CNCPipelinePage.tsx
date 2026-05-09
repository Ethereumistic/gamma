// src/features/cnc-pipeline/CNCPipelinePage.tsx

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Settings2, Save, ArrowUp, ArrowDown, RotateCcw } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { useWorkspace } from "@/features/workspace/context"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { BackendStatus } from "./components/BackendStatus"
import { DXFDropZone } from "./components/DXFDropZone"
import { LayerControls, LAYER_COLORS } from "./components/LayerControls"
import { GeometryViewer } from "./components/GeometryViewer"
import { NCPreview } from "./components/NCPreview"
import { PlaybackControls } from "./components/PlaybackControls"
import { useGenerate } from "./hooks/useGenerate"
import { usePlayback } from "./hooks/usePlayback"
import { deriveDefaultSequence } from "./tool-defaults"
import type { CustomSequence } from "./types"

const ALGORITHMS: { value: string; label: string; desc: string }[] = [
  { value: "juggler_gemini", label: "Juggler G", desc: "Shapely-powered optimal path selection 4" },
  { value: "juggler_claude", label: "Juggler C", desc: "Shapely-powered optimal path selection 5" },
]

const formatTime = (sec: number) => {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`
  return `${Math.round(sec)}s`
}

export default function CNCPipelinePage() {
  const navigate = useNavigate()
  const { selectedProjectId, selectedOrganizationId } = useWorkspace()
  const saveNcProgram = useMutation(api.nc_programs.saveNcProgram)

  // Fetch CNC tool overrides for the current org
  const cncSettings = useQuery(
    api.cnc_settings.getByOrganization,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip"
  )
  const toolOverrides = cncSettings?.toolOverrides

  const { state, upload, generateNC, reset } = useGenerate()

  const [algorithm, setAlgorithm] = useState(() => {
    return localStorage.getItem("cnc_default_algorithm") || "juggler_gemini"
  })

  const [dxfDisplayName, setDxfDisplayName] = useState("Unknown")
  const [ncSettings, setNcSettings] = useState(() => {
    const defaultSettings = { algorithm: false, time: false, scenario: false, custom: false, customText: "" }
    try {
      const stored = localStorage.getItem("cnc_nc_settings")
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings
    } catch {
      return defaultSettings
    }
  })

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

  const lastDxfFileRef = useRef<File | null>(null)
  const prevAlgorithmRef = useRef(algorithm)

  // ── Layer sequence state ──────────────────────────────────────────────────
  const [layerSequence, setLayerSequence] = useState<CustomSequence>([])

  const isCustomOrder = useMemo(() => {
    if (state.status !== "done" && state.status !== "ready" && state.status !== "generating") return false
    if (!state.geometry) return false
    const defaultSeq = deriveDefaultSequence(state.generate.scenario, state.geometry.layers)
    return JSON.stringify(layerSequence) !== JSON.stringify(defaultSeq)
  }, [layerSequence, state])

  const handleTraceModeToggle = (layer: string) => {
    setTraceMode(prev => ({ ...prev, [layer]: !prev[layer] }))
  }

  // ── NC lines — only available in "done" state ─────────────────────────────
  const ncLines = useMemo(
    () => (state.status === "done" ? state.ncText.split("\n") : []),
    [state]
  )

  // ── Segments and lineToSegmentMap — available in both "ready" and "done" ──
  const segments = (state.status === "ready" || state.status === "done" || (state.status === "generating" && state.geometry))
    ? state.geometry.segments
    : []

  const lineToSegmentMap = (state.status === "ready" || state.status === "done" || (state.status === "generating" && state.geometry))
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
    resetPlayback,
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
    setLayerSequence([])
    lastDxfFileRef.current = file
    setDxfDisplayName(file.name.replace(/\.dxf$/i, ""))
    resetPlayback()
    await upload(file, algorithm, toolOverrides)
  }

  const assembledFilename = useMemo(() => {
    if (state.status !== "done" && state.status !== "ready" && state.status !== "generating") return dxfDisplayName;
    const gen = state.generate;
    let parts = [dxfDisplayName]
    if (ncSettings.scenario && gen) {
      const activeScen = gen.scenario
      const shortCodeMap: Record<string, string> = { most_common: "F-C", common: "H-F-C", rare: "F-F135-C", very_rare: "H-F-F135-C", cut_only: "C" }
      if (shortCodeMap[activeScen]) parts.push(shortCodeMap[activeScen])
    }
    if (ncSettings.algorithm && gen) parts.push(gen.algorithm)
    if (ncSettings.time && gen) {
      const sec = Math.round(gen.estimated_time)
      const m = Math.floor(sec / 60)
      const s = sec % 60
      parts.push(`${m.toString().padStart(2, "0")}-${s.toString().padStart(2, "0")}`)
    }
    if (ncSettings.custom && ncSettings.customText) parts.push(ncSettings.customText.replace(/[\\/:*?"<>|]/g, ""))
    return parts.join("_")
  }, [dxfDisplayName, ncSettings, state])

  const [isSaving, setIsSaving] = useState(false)
  const handleSave = async () => {
    if (state.status !== "done" || !selectedProjectId || !selectedOrganizationId) return
    setIsSaving(true)
    try {
      const id = await saveNcProgram({
        projectId: selectedProjectId,
        organizationId: selectedOrganizationId,
        name: assembledFilename,
        algorithm: state.generate.algorithm,
        scenario: state.generate.scenario,
        estimatedTimeSeconds: state.generate.estimated_time,
        ncCode: state.ncText,
        dxfSourceName: lastDxfFileRef.current?.name || "unknown.dxf",
        geometryData: state.geometry ? {
          segments: state.geometry.segments,
          bbox: state.geometry.bbox,
        } : undefined,
        lineToSegmentMap: state.generate.line_to_segment_map || undefined,
        contoursByLayer: state.generate.contours_by_layer || undefined,
        stockBbox: state.generate.stock_bbox || undefined,
        customSequence: isCustomOrder ? layerSequence : undefined,
      })
      toast.success("NC program saved", { description: assembledFilename + ".nc" })
      navigate(`/cnc-pipeline/${id}`)
    } catch (e: any) {
      console.error(e)
      toast.error("Failed to save NC program", { description: e.message })
    } finally {
      setIsSaving(false)
    }
  }

  const updateSettings = (partial: any) => {
    setNcSettings((prev: any) => {
      const next = { ...prev, ...partial }
      localStorage.setItem("cnc_nc_settings", JSON.stringify(next))
      return next
    })
  }

  const updateDefaultAlgorithm = (val: string) => {
    setAlgorithm(val)
    localStorage.setItem("cnc_default_algorithm", val)
  }

  useEffect(() => {
    if (prevAlgorithmRef.current !== algorithm) {
      prevAlgorithmRef.current = algorithm
      if ((state.status === "done" || state.status === "ready") && lastDxfFileRef.current) {
        resetPlayback()
        const customSeq = isCustomOrder ? layerSequence : undefined
        upload(lastDxfFileRef.current, algorithm, toolOverrides, customSeq)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithm, state.status, upload, resetPlayback, isCustomOrder, layerSequence, toolOverrides])

  // ── Layer change handler ──────────────────────────────────────────────────
  const handleLayerSequenceChange = useCallback(async (newSequence: CustomSequence) => {
    setLayerSequence(newSequence)
    if ((state.status === "done" || state.status === "ready") && lastDxfFileRef.current) {
      resetPlayback()
      const defaultSeq = deriveDefaultSequence(state.generate.scenario, state.geometry.layers)
      const customSeq = JSON.stringify(newSequence) === JSON.stringify(defaultSeq) ? undefined : newSequence
      await upload(lastDxfFileRef.current, algorithm, toolOverrides, customSeq)
    }
  }, [state, algorithm, toolOverrides, upload, resetPlayback])

  // Initialise layer visibility and sequence when geometry loads
  if (
    (state.status === "ready" || state.status === "done") &&
    state.geometry.layers.some((l) => !(l in visible))
  ) {
    const init: Record<string, boolean> = {}
    state.geometry.layers.forEach((l) => { init[l] = true })
    setVisible(init)
  }

  // Initialize layer sequence from detected scenario when geometry first loads
  useEffect(() => {
    if (
      (state.status === "ready" || state.status === "done") &&
      layerSequence.length === 0
    ) {
      const gen = state.generate;
      const geo = state.geometry;
      if (gen && geo) {
        const defaultSeq = deriveDefaultSequence(gen.scenario, geo.layers)
        if (defaultSeq.length > 0) {
          setLayerSequence(defaultSeq)
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, layerSequence.length])

  const currentAlgorithm = (state.status === "ready" || state.status === "done" || state.status === "generating")
    ? state.generate.algorithm
    : algorithm

  const activeAlgoLabel = ALGORITHMS.find(a => a.value === currentAlgorithm)?.label ?? algorithm

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

          {(state.status === "ready" || state.status === "done" || state.status === "generating") ? (
            <>
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <input
                type="text"
                value={dxfDisplayName}
                onChange={(e) => setDxfDisplayName(e.target.value)}
                className="font-semibold text-slate-200 tracking-wide truncate max-w-[200px] bg-transparent border-none outline-none focus:ring-1 focus:ring-emerald-500 rounded px-1 -mx-1"
              />
              <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
              <div className="flex items-center gap-1 font-medium whitespace-nowrap">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
                  Sequence
                </span>
                {layerSequence.map(([layer, toolNum], idx) => (
                  <div key={layer} className="flex items-center gap-0.5">
                    {idx > 0 && (
                      <span className="text-slate-600 mx-0.5">→</span>
                    )}
                    <Select
                      value={String(idx)}
                      onValueChange={(val) => {
                        const newIdx = parseInt(val, 10)
                        if (newIdx !== idx) {
                          const newSeq = [...layerSequence]
                          const [moved] = newSeq.splice(idx, 1)
                          newSeq.splice(newIdx, 0, moved)
                          handleLayerSequenceChange(newSeq)
                        }
                      }}
                      disabled={state.status === "generating"}
                    >
                      <SelectTrigger
                        className="h-6 w-auto min-w-[48px] bg-black/20 border-none text-[10px] font-bold uppercase tracking-wider px-1.5 hover:bg-white/5 focus:ring-1 focus:ring-emerald-500"
                        style={{ color: LAYER_COLORS[layer] ?? "#cbd5e1" }}
                      >
                        {layer}
                      </SelectTrigger>
                      <SelectContent>
                        {layerSequence.map((_, optionIdx) => (
                          <SelectItem key={optionIdx} value={String(optionIdx)}>
                            <span className="text-[10px] font-mono text-slate-400">{optionIdx + 1}.</span>{" "}
                            <span className="text-xs font-medium uppercase">{layer}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span
                      className="text-[9px] font-mono text-slate-600 tabular-nums"
                      title={`Tool T${toolNum}`}
                    >
                      T{toolNum}
                    </span>
                  </div>
                ))}
                {isCustomOrder && (
                  <span className="text-[9px] text-amber-400/70 ml-1 italic">custom</span>
                )}
              </div>
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
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 px-3 text-xs hover:bg-white/5 flex gap-1.5">
                      <Settings2 className="h-3.5 w-3.5" />
                      Settings
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>NC Program Settings</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">

                      <div className="grid gap-2 mb-2">
                        <Label>Default Algorithm</Label>
                        <Select value={algorithm} onValueChange={updateDefaultAlgorithm}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ALGORITHMS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* ── Layer Sequence ── */}
                      {layerSequence.length > 0 && (
                        <div className="grid gap-2 pt-4 border-t border-white/10">
                          <div className="flex items-center justify-between">
                            <Label className="font-semibold">Layer Sequence</Label>
                            {isCustomOrder && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] text-slate-400 hover:text-white"
                                onClick={() => {
                                  const defaultSeq = deriveDefaultSequence(
                                    state.generate.scenario,
                                    state.geometry.layers,
                                  )
                                  handleLayerSequenceChange(defaultSeq)
                                }}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Reset Order
                              </Button>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500">
                            Reorder layers to change CNC execution order. This affects tool change sequence in the NC program.
                          </p>
                          <div className="space-y-1">
                            {layerSequence.map(([layer, toolNum], idx) => {
                              const color = LAYER_COLORS[layer] ?? "#cbd5e1"
                              return (
                                <div
                                  key={layer}
                                  className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2"
                                >
                                  <span className="text-[10px] font-mono text-slate-500 tabular-nums w-4">
                                    {idx + 1}
                                  </span>
                                  <div
                                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>
                                    {layer}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-500 ml-auto">
                                    T{toolNum}
                                  </span>
                                  <div className="flex items-center gap-0.5 ml-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 w-5 p-0 text-slate-500 hover:text-white disabled:opacity-20"
                                      disabled={idx === 0 || state.status === "generating"}
                                      onClick={() => {
                                        const newSeq = [...layerSequence]
                                        ;[newSeq[idx - 1], newSeq[idx]] = [newSeq[idx], newSeq[idx - 1]]
                                        handleLayerSequenceChange(newSeq)
                                      }}
                                    >
                                      <ArrowUp className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 w-5 p-0 text-slate-500 hover:text-white disabled:opacity-20"
                                      disabled={idx === layerSequence.length - 1 || state.status === "generating"}
                                      onClick={() => {
                                        const newSeq = [...layerSequence]
                                        ;[newSeq[idx], newSeq[idx + 1]] = [newSeq[idx + 1], newSeq[idx]]
                                        handleLayerSequenceChange(newSeq)
                                      }}
                                    >
                                      <ArrowDown className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      <div className="grid gap-4 pt-4 border-t border-white/10">
                        <div className="flex flex-col gap-1">
                          <Label>Filename Suffix Settings</Label>
                          <span className="text-xs text-emerald-400 font-mono break-all">{assembledFilename}.nc</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <Label className="font-normal font-mono text-xs">Append Scenario (e.g. _F-C)</Label>
                          <Switch checked={ncSettings.scenario} onCheckedChange={c => updateSettings({ scenario: c })} />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="font-normal font-mono text-xs">Append Algorithm (e.g. _raptor)</Label>
                          <Switch checked={ncSettings.algorithm} onCheckedChange={c => updateSettings({ algorithm: c })} />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="font-normal font-mono text-xs">Append Est. Time (e.g. _04-20)</Label>
                          <Switch checked={ncSettings.time} onCheckedChange={c => updateSettings({ time: c })} />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="font-normal font-mono text-xs">Append Custom Text</Label>
                          <Switch checked={ncSettings.custom} onCheckedChange={c => updateSettings({ custom: c })} />
                        </div>
                        {ncSettings.custom && (
                          <Input
                            value={ncSettings.customText}
                            onChange={e => updateSettings({ customText: e.target.value })}
                            className="h-8 text-xs font-mono"
                            placeholder="custom-suffix"
                          />
                        )}
                      </div>

                    </div>
                  </DialogContent>
                </Dialog>

                {state.status === "done" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="h-8 px-3 text-xs border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-400"
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                )}
                <div className="h-4 w-px bg-white/10 mx-2 shrink-0" />
                <DXFDropZone onFile={handleFile} disabled={state.status === "generating"} compact />
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

      {state.status === "generating" && !state.geometry && (
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

      {(state.status === "ready" || state.status === "done" || (state.status === "generating" && state.geometry)) && (
        <div className="grid grid-cols-12 gap-6 h-full min-h-0 relative">

          {state.status === "generating" && (
            <div className="absolute inset-0 bg-black/40 z-50 flex flex-col items-center justify-center backdrop-blur-sm rounded-lg">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mb-4 mt-[35vh]"></div>
              <p className="text-emerald-400 font-medium tracking-wide">Generating NC program…</p>
            </div>
          )}

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