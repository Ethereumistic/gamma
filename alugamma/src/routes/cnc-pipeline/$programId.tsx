import { useQuery, useMutation } from "convex/react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { NCPreview } from "@/features/cnc-pipeline/components/NCPreview";
import { PlaybackControls } from "@/features/cnc-pipeline/components/PlaybackControls";
import { GeometryViewer } from "@/features/cnc-pipeline/components/GeometryViewer";
import { LayerControls, LAYER_COLORS } from "@/features/cnc-pipeline/components/LayerControls";
import { usePlayback } from "@/features/cnc-pipeline/hooks/usePlayback";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Save, Settings2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { regenerate } from "@/features/cnc-pipeline/api";
import type { GeometryResponse } from "@/features/cnc-pipeline/types";

const ALGORITHMS = [
  { value: "raptor", label: "v0.4 Raptor", desc: "Polar clockwise sweep with ring clustering" },
  { value: "anchor", label: "v0.5 Anchor", desc: "Vacuum anchor preservation priority" },
  { value: "oracle", label: "v1.0 Oracle", desc: "AI-powered optimal path selection" },
  { value: "shapely", label: "v0.1 Shapely", desc: "Shapely-powered optimal path selection" },
  { value: "conman", label: "v1.0 ConMan", desc: "Shapely-powered optimal path selection 2" },
  { value: "conman_v2", label: "v1.0 ConMan v2", desc: "Shapely-powered optimal path selection 3" },
  { value: "juggler_gemini", label: "v1.0 Juggler Gemini", desc: "Shapely-powered optimal path selection 4" },
  { value: "juggler_claude", label: "v1.0 Juggler Claude", desc: "Shapely-powered optimal path selection 5" },
];

const SCENARIO_LABELS: Record<string, string> = {
  most_common: "FREZ → CUT",
  common: "HOLES → FREZ → CUT",
  rare: "FREZ → FREZ_135 → CUT",
  very_rare: "HOLES → FREZ → FREZ_135 → CUT",
  cut_only: "CUT only",
};

const formatTime = (sec: number) => {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  return `${Math.round(sec)}s`;
};

export default function CNCProgramViewerPage() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const program = useQuery(api.nc_programs.getById, { programId: programId as Id<"nc_programs"> });
  const updateNcProgram = useMutation(api.nc_programs.updateNcProgram);

  const [editName, setEditName] = useState<string>("");
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<string>("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  const [currentGeometry, setCurrentGeometry] = useState<GeometryResponse | null>(null);
  const [currentNcLines, setCurrentNcLines] = useState<string[]>([]);
  const [currentLineToSegmentMap, setCurrentLineToSegmentMap] = useState<Record<number, number>>({});
  const [currentEstimatedTime, setCurrentEstimatedTime] = useState(0);

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

  // Sync edits from program
  useEffect(() => {
    if (program) {
      setEditName(program.name);
      
      // Only set initial state if we haven't already customized it
      if (currentNcLines.length === 0) {
        setSelectedAlgorithm(program.algorithm);
        setCurrentNcLines(program.ncCode.split("\n"));
        if (program.lineToSegmentMap) {
          setCurrentLineToSegmentMap(
            Object.fromEntries(
              Object.entries(program.lineToSegmentMap).map(([k, v]) => [Number(k), v as number])
            )
          );
        }
        if (program.geometryData) {
          // @ts-ignore
          setCurrentGeometry(program.geometryData);
        }
        setCurrentEstimatedTime(program.estimatedTimeSeconds);
      }
    }
  }, [program, programId]);

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

  const hasRegenerated = selectedAlgorithm !== (program?.algorithm);
  const isDirty = hasRegenerated || (program && editName !== program.name);

  async function handleRegenerate(newAlgorithm: string) {
    if (!program?.contoursByLayer || !program?.stockBbox) return;
    if (newAlgorithm === selectedAlgorithm) return;

    setIsRegenerating(true);
    resetPlayback();

    try {
      const result = await regenerate({
        contours_by_layer: program.contoursByLayer,
        stock_bbox: program.stockBbox,
        scenario: program.scenario,
        algorithm: newAlgorithm,
      });

      setCurrentGeometry(result.geometry_data);
      setCurrentNcLines(result.nc_text.split("\n"));
      setCurrentLineToSegmentMap(
        Object.fromEntries(
          Object.entries(result.line_to_segment_map).map(([k, v]) => [Number(k), v])
        )
      );
      setCurrentEstimatedTime(result.estimated_time);
      setSelectedAlgorithm(newAlgorithm);
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
        });
      } else {
        await updateNcProgram({
          projectId: program.projectId,
          ncProgramId: program._id,
          name: editName,
        });
      }
      toast.success("NC Program Details Updated");
    } catch (e: any) {
      toast.error("Failed to update", { description: e.message });
    }
  };


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
            onValueChange={handleRegenerate}
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
          <span className="flex items-center gap-1 font-medium whitespace-nowrap">
            {(SCENARIO_LABELS[activeScenario] ?? activeScenario).split(" ").map((word: string, i: number) => {
              if (word === "→" || word === "only") return <span key={i} className="text-slate-500">{word}</span>
              return <span key={i} style={{ color: LAYER_COLORS[word] ?? "#cbd5e1" }}>{word}</span>
            })}
          </span>
          <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
          <span className="text-slate-400 whitespace-nowrap">
            Time: <span className="text-slate-200 font-medium ml-1">{formatTime(activeTime)}</span>
          </span>

          <div className="ml-auto flex items-center gap-2 pl-4">
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs border border-transparent text-slate-400 hover:text-white hover:bg-white/5">
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleSave} 
              disabled={!isDirty}
              className={`h-8 px-3 text-xs border hover:bg-emerald-500/10 hover:text-emerald-400 transition-all ${
                isDirty 
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
