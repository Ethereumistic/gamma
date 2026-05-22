import { useQuery, useMutation } from "convex/react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { NCPreview } from "@/features/cnc-pipeline/components/NCPreview";
import { PlaybackControls } from "@/features/cnc-pipeline/components/PlaybackControls";
import { GeometryViewer } from "@/features/cnc-pipeline/components/GeometryViewer";
import { LayerControls, LAYER_COLORS, getLayerColor } from "@/features/cnc-pipeline/components/LayerControls";
import { SequencePill } from "@/features/cnc-pipeline/components/SequencePill";
import { AddLayerDropdown } from "@/features/cnc-pipeline/components/AddLayerDropdown";
import { usePlayback } from "@/features/cnc-pipeline/hooks/usePlayback";
import type { GeometryResponse, CustomSequence, IdSequence } from "@/features/cnc-pipeline/types";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Save, Settings2, ArrowUp, ArrowDown, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { regenerate } from "@/features/cnc-pipeline/api";
import { deriveDefaultSequence, resolveTools, TOOL_DEFAULTS, LAYER_TOOL_MAP_DEFAULTS, resolveLayerToolMap, type ToolConfig } from "@/features/cnc-pipeline/tool-defaults";
import { useWorkspace } from "@/features/workspace/context";

const ALGORITHMS = [
  { value: "juggler_gemini", label: "Juggler G", desc: "Shapely-powered optimal path selection 4" },
  { value: "juggler_claude", label: "Juggler C", desc: "Shapely-powered optimal path selection 5" },
];

const formatTime = (sec: number) => {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  return `${Math.round(sec)}s`;
};

export default function CNCProgramViewerPage() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const program = useQuery(api.nc_programs.getById, { programId: programId as Id<"nc_programs"> });
  const updateNcProgram = useMutation(api.nc_programs.updateNcProgram);

  // Fetch CNC tool overrides for the current org
  const { selectedOrganizationId } = useWorkspace();
  const cncSettings = useQuery(
    api.cnc_settings.getByOrganization,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip"
  );
  const toolOverrides = cncSettings?.toolOverrides;

  const resolvedTools = useMemo(
    () => resolveTools(TOOL_DEFAULTS, toolOverrides ?? {}, null),
    [toolOverrides]
  )

  const resolvedLayerToolMap = useMemo(
    () => resolveLayerToolMap(LAYER_TOOL_MAP_DEFAULTS, cncSettings?.layerToolMap ?? null, resolvedTools),
    [resolvedTools, cncSettings?.layerToolMap]
  )

  const [editName, setEditName] = useState<string>("");
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<string>("");
  const [isRegenerating, setIsRegenerating] = useState(false);

  const [currentGeometry, setCurrentGeometry] = useState<GeometryResponse | null>(null);
  const [currentNcLines, setCurrentNcLines] = useState<string[]>([]);
  const [currentLineToSegmentMap, setCurrentLineToSegmentMap] = useState<Record<number, number>>({});
  const [currentEstimatedTime, setCurrentEstimatedTime] = useState(0);

  // ── Layer sequence state ──────────────────────────────────────────────────
  const [layerSequence, setLayerSequence] = useState<IdSequence>([]);

  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  // States for geometry viewer
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [showRapids, setShowRapids] = useState(true);
  const [traceMode, setTraceMode] = useState<Record<string, boolean>>({
    HOLES: false,
    FREZ: false,
    FREZ_135: false,
    CUT: false,
    RAPIDS: false,
  });

  const activeScenario = program?.scenario || "unknown";
  const activeTime = currentEstimatedTime || program?.estimatedTimeSeconds || 0;

  // Maps
  const segmentToLineMap: Record<number, number> = useMemo(() => {
    return Object.fromEntries(
      Object.entries(currentLineToSegmentMap).map(([line, seq]) => [seq, Number(line)])
    );
  }, [currentLineToSegmentMap]);

  // Playback
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
  } = usePlayback(currentNcLines, currentGeometry?.segments || [], currentLineToSegmentMap);

  const [loadedProgramId, setLoadedProgramId] = useState<string | null>(null);

  // Sync edits from program
  useEffect(() => {
    if (program && program._id !== loadedProgramId) {
      setLoadedProgramId(program._id);
      setEditName(program.name);

      setSelectedAlgorithm(program.algorithm);
      setCurrentNcLines(program.ncCode.split("\n"));
      if (program.lineToSegmentMap) {
        setCurrentLineToSegmentMap(
          Object.fromEntries(
            Object.entries(program.lineToSegmentMap).map(([k, v]) => [Number(k), v as number])
          )
        );
      } else {
        setCurrentLineToSegmentMap({});
      }
      if (program.geometryData) {
        // @ts-ignore
        setCurrentGeometry(program.geometryData);
      } else {
        setCurrentGeometry(null);
      }
      setCurrentEstimatedTime(program.estimatedTimeSeconds);
      setVisible({});

      // Initialize layer sequence from program's saved custom sequence or default
      if (program.customSequence && Array.isArray(program.customSequence) && program.customSequence.length > 0) {
        const seq = program.customSequence;
        // Always normalize to id-based format
        setLayerSequence(seq.map(([layer, toolRef]) => {
          if (typeof toolRef === "string") {
            // Already id-based
            return [layer, toolRef] as [string, string];
          } else {
            // Legacy number-based — migrate to id
            const toolNum = Number(toolRef);
            const match = Object.entries(resolvedTools).find(([, t]) => t.number === toolNum);
            // Prefer tool that has this layer in its layers dict
            const layerMatch = Object.entries(resolvedTools)
              .filter(([, t]) => t.number === toolNum && layer in t.layers);
            const resolvedId = layerMatch.length > 0 ? layerMatch[0][0] : (match ? match[0] : Object.keys(resolvedTools)[0] ?? "prav");
            return [layer, resolvedId] as [string, string];
          }
        }))
      } else {
        const detectedLayers = program.contoursByLayer
          ? Object.keys(program.contoursByLayer)
          : []
        const defaultSeq = deriveDefaultSequence(program.scenario, detectedLayers, resolvedLayerToolMap)
        setLayerSequence(defaultSeq)
      }
    }
  }, [program, loadedProgramId]);

  // Layout logic
  useEffect(() => {
    const el = document.getElementById("cnc-navbar-portal");
    if (el) {
      setPortalNode(el);
    } else {
      const observer = new MutationObserver(() => {
        const node = document.getElementById("cnc-navbar-portal");
        if (node) {
          setPortalNode(node);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    }
  }, []);

  useEffect(() => {
    if (currentGeometry && Object.keys(visible).length === 0) {
      const init: Record<string, boolean> = {};
      const uniqueLayers = [...new Set(currentGeometry.segments.map(s => s.layer))];
      uniqueLayers.forEach((l) => { init[l] = true });
      setVisible(init);
    }
  }, [currentGeometry, visible]);

  // Handlers
  const handleLayerToggle = (layer: string, value: boolean) => {
    setVisible((prev) => ({ ...prev, [layer]: value }));
  };
  const handleTraceModeToggle = (layer: string) => {
    setTraceMode(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  const handleDownload = () => {
    const blob = new Blob([currentNcLines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${editName}.nc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isCustomOrder = useMemo(() => {
    if (!program) return false
    const detectedLayers = program.contoursByLayer ? Object.keys(program.contoursByLayer) : []
    const defaultSeq = deriveDefaultSequence(program.scenario, detectedLayers, resolvedLayerToolMap)
    return JSON.stringify(layerSequence) !== JSON.stringify(defaultSeq)
  }, [layerSequence, program, resolvedLayerToolMap])

  const hasRegenerated = selectedAlgorithm !== (program?.algorithm) || isCustomOrder;
  const isDirty = hasRegenerated || (program && editName !== program.name);

  async function handleRegenerate(newAlgorithm?: string, newSequence?: IdSequence) {
    if (!program?.contoursByLayer || !program?.stockBbox) return;

    const algo = newAlgorithm ?? selectedAlgorithm
    const seq = newSequence ?? layerSequence
    if (algo === selectedAlgorithm && !newSequence) return;

    setIsRegenerating(true);
    resetPlayback();

    try {
      const detectedLayers = Object.keys(program.contoursByLayer)
      const defaultSeq = deriveDefaultSequence(program.scenario, detectedLayers, resolvedLayerToolMap)
      const customSeq = JSON.stringify(seq) === JSON.stringify(defaultSeq) ? undefined : seq

      const result = await regenerate({
        contours_by_layer: program.contoursByLayer,
        stock_bbox: program.stockBbox,
        scenario: program.scenario,
        algorithm: algo,
        tool_overrides: toolOverrides,
        custom_sequence: customSeq,
      });

      setCurrentGeometry(result.geometry_data);
      setCurrentNcLines(result.nc_text.split("\n"));
      setCurrentLineToSegmentMap(
        Object.fromEntries(
          Object.entries(result.line_to_segment_map).map(([k, v]) => [Number(k), v])
        )
      );
      setCurrentEstimatedTime(result.estimated_time);
      setSelectedAlgorithm(algo);
      if (newSequence) setLayerSequence(newSequence);
    } catch (err) {
      toast.error("Regeneration failed", { description: String(err) });
    } finally {
      setIsRegenerating(false);
    }
  }

  const handleSave = async () => {
    if (!program || !program.projectId) return;
    try {
      if (hasRegenerated) {
        await updateNcProgram({
          projectId: program.projectId,
          ncProgramId: program._id,
          name: editName,
          algorithm: selectedAlgorithm,
          scenario: program.scenario,
          estimatedTimeSeconds: currentEstimatedTime,
          ncCode: currentNcLines.join("\n"),
          geometryData: currentGeometry ? {
            segments: currentGeometry.segments,
            bbox: currentGeometry.bbox,
          } : undefined,
          lineToSegmentMap: currentLineToSegmentMap,
          customSequence: isCustomOrder ? layerSequence : undefined,
        });
      } else {
        await updateNcProgram({
          projectId: program.projectId,
          ncProgramId: program._id,
          name: editName,
          customSequence: isCustomOrder ? layerSequence : undefined,
        });
      }
      toast.success("NC Program Details Updated");
    } catch (e: any) {
      toast.error("Failed to update", { description: e.message });
    }
  };


  // Build the set of CNC-active layers (built-in + layer-tool map + current program sequence)
  const cncLayerNames = useMemo(() => {
    const s = new Set(["CUT", "FREZ", "FREZ_135", "HOLES"])
    for (const layer of Object.keys(resolvedLayerToolMap)) {
      s.add(layer)
    }
    // Also include layers from the current program's machining sequence
    for (const [layer] of layerSequence) {
      s.add(layer)
    }
    // Include layers from the program's contours that match known CNC patterns
    if (program?.contoursByLayer) {
      for (const layer of Object.keys(program.contoursByLayer)) {
        if (resolvedLayerToolMap[layer]) {
          s.add(layer)
        }
      }
    }
    return s
  }, [resolvedLayerToolMap, layerSequence, program?.contoursByLayer])

  if (program === undefined) {
    return <div className="p-8 text-slate-400 flex items-center justify-center">Loading program...</div>;
  }
  if (program === null) {
    return <div className="p-8 text-red-400 flex items-center justify-center">Program not found or access denied.</div>;
  }

  const uniqueLayers = currentGeometry ? [...new Set(currentGeometry.segments.map(s => s.layer))] : [];

  return (
    <div className="p-6 h-[calc(100vh-4rem)] flex flex-col text-slate-200">

      {portalNode && createPortal(
        <div className="flex items-center gap-3 w-full text-xs">
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="font-semibold text-emerald-400 tracking-wide truncate max-w-[200px] border border-emerald-500/20 bg-emerald-500/10 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <span className="text-emerald-400/50 font-mono -ml-2">.nc</span>

          <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />

          <Select
            value={selectedAlgorithm}
            onValueChange={(val) => handleRegenerate(val)}
            disabled={isRegenerating || !program?.contoursByLayer}
          >
            <SelectTrigger className="h-7 w-[130px] bg-black/20 border-white/10 text-[10px] font-mono hover:bg-white/5 focus:ring-1 focus:ring-emerald-500 uppercase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGORITHMS.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  <div className="flex flex-col">
                    <span className="font-medium text-xs normal-case">{a.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
          <div className="flex items-center gap-1 font-medium whitespace-nowrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
              Sequence
            </span>
            {layerSequence.map(([layer, toolId], idx) => (
              <div key={layer} className="flex items-center">
                {idx > 0 && (
                  <span className="text-slate-600 mx-0.5">→</span>
                )}
                <SequencePill
                  layer={layer}
                  color={getLayerColor(layer)}
                  toolLabel={`T${resolvedTools[toolId]?.number ?? 0}`}
                  disabled={isRegenerating || !program?.contoursByLayer}
                  onRemove={() => {
                    const newSeq = [...layerSequence]
                    newSeq.splice(idx, 1)
                    handleRegenerate(undefined, newSeq)
                  }}
                  onReorder={(newIdx) => {
                    const newSeq = [...layerSequence]
                    const [moved] = newSeq.splice(idx, 1)
                    newSeq.splice(newIdx, 0, moved)
                    handleRegenerate(undefined, newSeq)
                  }}
                  currentIndex={idx}
                  totalCount={layerSequence.length}
                  availableTools={Object.entries(resolvedTools)
                    .sort(([, a], [, b]) => a.number - b.number)
                    .map(([key, t]) => ({
                      value: key,
                      label: `T${t.number}`,
                      description: `${t.name} (${t.id})`,
                    }))}
                  currentToolValue={toolId}
                  onToolChange={(val) => {
                    const newSeq = [...layerSequence]
                    newSeq[idx] = [layerSequence[idx][0], val]
                    handleRegenerate(undefined, newSeq)
                  }}
                />
              </div>
            ))}
          </div>

          <AddLayerDropdown
            availableLayers={(() => {
              const assigned = new Set(layerSequence.map(([l]) => l))
              const allLayerKeys = new Set([
                ...(program?.contoursByLayer ? Object.keys(program.contoursByLayer) : []),
                ...Object.keys(resolvedLayerToolMap),
              ])
              return [...allLayerKeys].filter((l) => !assigned.has(l)).map((layer) => {
                const toolId = resolvedLayerToolMap[layer] ?? Object.keys(resolvedTools).sort((a, b) => resolvedTools[a].number - resolvedTools[b].number)[0] ?? "prav"
                const toolNum = resolvedTools[toolId]?.number ?? 0
                return {
                  layer,
                  color: getLayerColor(layer),
                  toolLabel: toolNum ? `T${toolNum}` : "T?",
                }
              })
            })()}
            onAddLayer={(layer) => {
              const toolId = resolvedLayerToolMap[layer] ?? Object.keys(resolvedTools).sort((a, b) => resolvedTools[a].number - resolvedTools[b].number)[0] ?? "prav"
              const newSeq = [...layerSequence, [layer, toolId] as [string, string]]
              handleRegenerate(undefined, newSeq)
            }}
            disabled={isRegenerating}
          />
          <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
          <span className="text-slate-400 whitespace-nowrap">
            Time: <span className="text-slate-200 font-medium ml-1">{formatTime(activeTime)}</span>
          </span>

          <div className="ml-auto flex items-center gap-2 pl-4">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-white/5">
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>NC Program Settings</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  {/* ── Layer Sequence ── */}
                  {layerSequence.length > 0 && (
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="font-semibold">Layer Sequence</Label>
                        {isCustomOrder && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] text-slate-400 hover:text-white"
                            onClick={() => {
                              if (!program) return
                              const detectedLayers = program.contoursByLayer ? Object.keys(program.contoursByLayer) : []
                              const defaultSeq = deriveDefaultSequence(program.scenario, detectedLayers, resolvedLayerToolMap)
                              handleRegenerate(undefined, defaultSeq)
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
                        {layerSequence.map(([layer, toolId], idx) => {
                          const color = getLayerColor(layer)
                          const tool = resolvedTools[toolId]
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
                                T{tool?.number ?? "?"}
                              </span>
                              <div className="flex items-center gap-0.5 ml-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-slate-500 hover:text-white disabled:opacity-20"
                                  disabled={idx === 0 || isRegenerating}
                                  onClick={() => {
                                    const newSeq = [...layerSequence]
                                    ;[newSeq[idx - 1], newSeq[idx]] = [newSeq[idx], newSeq[idx - 1]]
                                    handleRegenerate(undefined, newSeq)
                                  }}
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-slate-500 hover:text-white disabled:opacity-20"
                                  disabled={idx === layerSequence.length - 1 || isRegenerating}
                                  onClick={() => {
                                    const newSeq = [...layerSequence]
                                    ;[newSeq[idx], newSeq[idx + 1]] = [newSeq[idx + 1], newSeq[idx]]
                                    handleRegenerate(undefined, newSeq)
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
                </div>
              </DialogContent>
            </Dialog>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty}
              className={`h-8 px-3 text-xs border hover:bg-emerald-500/10 hover:text-emerald-400 transition-all ${isDirty
                  ? "border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)] text-emerald-400"
                  : "border-transparent text-slate-400 bg-white/5"
                }`}
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save
            </Button>
            <Button variant="default" size="sm" onClick={handleDownload} className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 text-white">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download .nc
            </Button>
          </div>
        </div>,
        portalNode
      )}

      <div className="grid grid-cols-12 gap-6 h-full min-h-0 relative">
        <div className="col-span-3 h-full min-h-0">
          <NCPreview
            ncText={currentNcLines.join("\n")}
            jobId={program._id}
            currentLineIndex={currentLineIndex}
            onLineClick={seekToLine}
          />
        </div>

        <div className="col-span-9 h-full min-h-0">
          <Card className={`bg-transparent h-full flex flex-col shadow-none transition-all ${hasRegenerated ? "border-emerald-500/50 relative overflow-hidden" : "border-white/10"}`}>

            {hasRegenerated && (
              <div className="absolute inset-0 pointer-events-none rounded-[inherit] overflow-hidden">
                <div className="absolute inset-0 border-[2px] border-emerald-500/20 box-border rounded-[inherit] shadow-[inset_0_0_40px_rgba(16,185,129,0.1)]"></div>
              </div>
            )}

            {isRegenerating && (
              <div className="absolute inset-0 bg-black/40 z-50 flex flex-col items-center justify-center backdrop-blur-sm rounded-lg">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mb-4"></div>
                <p className="text-emerald-400 font-medium tracking-wide">Regenerating NC program…</p>
              </div>
            )}

            <CardHeader className="py-2 px-4 border-b border-white/5 flex flex-row items-center justify-between shrink-0 h-14 space-y-0">
              <div className="flex items-center gap-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-2">Preview</span>
                {currentGeometry && (
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
              <div className="flex items-center min-w-0 flex-1 justify-end relative z-10">
                {currentGeometry ? (
                  <div className="overflow-x-auto no-scrollbar py-1">
                    <LayerControls
                      layers={uniqueLayers}
                      visible={visible}
                      onChange={handleLayerToggle}
                      // @ts-ignore
                      geometrySegments={currentGeometry.segments}
                      segmentToLineMap={segmentToLineMap}
                      onSeek={seekToLine}
                      showRapids={showRapids}
                      onToggleRapids={setShowRapids}
                      traceMode={traceMode}
                      onTraceModeToggle={handleTraceModeToggle}
                      cncLayerNames={cncLayerNames}
                    />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/60">Geometry rendering unavailable</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative overflow-hidden min-h-0 flex items-center justify-center bg-black/40">
              {currentGeometry ? (
                <GeometryViewer
                  // @ts-ignore
                  geometry={{ ...currentGeometry, layers: uniqueLayers }}
                  visible={visible}
                  showRapids={showRapids}
                  currentLineIndex={currentLineIndex}
                  lineToSegmentMap={currentLineToSegmentMap}
                  segmentToLineMap={segmentToLineMap}
                  onSeek={seekToLine}
                  playbackSpeed={playbackSpeed}
                  rapidSpeedMultiplier={rapidPlaybackSpeed}
                  seekTrigger={seekTrigger}
                  ncLines={currentNcLines}
                  isPlaying={isPlaying}
                  traceMode={traceMode}
                  cncLayerNames={cncLayerNames}
                />
              ) : (
                <div className="text-center text-slate-500 max-w-[400px]">
                  <p className="mb-3 text-sm">Geometry preview is unavailable for this program. It was likely saved before geometry persistence was added.</p>
                  {!program?.contoursByLayer && (
                    <p className="text-xs">
                      Algorithm switching is available for programs saved after this feature was introduced.
                      Re-save this program to enable it.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
            <div className="h-12 border-t border-white/5 px-4 flex items-center shrink-0 bg-black/20 relative z-10">
              <PlaybackControls
                isPlaying={isPlaying}
                onTogglePlay={() => setIsPlaying(!isPlaying)}
                currentLine={currentLineIndex}
                totalLines={currentNcLines.length}
                onSeek={seekToLine}
                totalDuration={totalDuration}
                currentSimTime={currentSimTime}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
