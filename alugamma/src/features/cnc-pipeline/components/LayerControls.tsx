import { Target } from "lucide-react"
import type { Segment } from "../types"

// One fixed color per layer name — for visual distinction in the viewer
export const LAYER_COLORS: Record<string, string> = {
  CUT: "#22c55e",     // green
  FREZ: "#a855f7",    // purple
  FREZ_135: "#f97316", // orange
  HOLES: "#f9ca01",   // yellow
  SHEETS: "#38bdf8",  // sky blue
  "0": "#94a3b8",     // slate
}

// Layers that are included in CNC toolpath generation
const CNC_LAYERS = new Set(["CUT", "FREZ", "FREZ_135", "HOLES"])

interface Props {
  layers: string[]
  visible: Record<string, boolean>
  onChange: (layer: string, value: boolean) => void
  geometrySegments?: Segment[]
  segmentToLineMap?: Record<number, number>
  onSeek?: (line: number) => void
  showRapids?: boolean
  onToggleRapids?: (val: boolean) => void
}

export function LayerControls({
  layers,
  visible,
  onChange,
  geometrySegments,
  segmentToLineMap,
  onSeek,
  showRapids = true,
  onToggleRapids,
}: Props) {
  const cncLayers = layers.filter((l) => CNC_LAYERS.has(l))
  const refLayers = layers.filter((l) => !CNC_LAYERS.has(l))

  const handleHop = (e: React.MouseEvent, layer: string) => {
    e.stopPropagation()
    if (!geometrySegments || !segmentToLineMap || !onSeek) return
    const firstSeg = geometrySegments.find((s) => s.layer === layer)
    if (firstSeg) {
      const line = segmentToLineMap[firstSeg.seq_index]
      if (line !== undefined) onSeek(line)
    }
  }

  const renderLayer = (layer: string, isRef: boolean) => {
    const isActive = visible[layer] ?? true
    const color = LAYER_COLORS[layer] ?? "#fff"

    return (
      <div
        key={layer}
        className={`flex items-center gap-1.5 transition-all ${isActive ? "opacity-100" : "opacity-40 hover:opacity-70 grayscale-[50%]"}`}
      >
        <button
          onClick={() => onChange(layer, !isActive)}
          onDoubleClick={(e) => !isRef && handleHop(e, layer)}
          className="flex items-center gap-1.5 outline-none hover:text-white"
          title={
            isRef
              ? "Reference only — not included in CNC output"
              : `Toggle ${layer} layer (Double-click to seek start)`
          }
        >
          <div
            className={`w-3 h-3 rounded-[2px] shrink-0 ${isRef ? "border border-dashed" : "border"}`}
            style={{
              backgroundColor: isActive ? (isRef ? color + "66" : color) : "transparent",
              borderColor: isActive ? (isRef ? color + "99" : color) : "#64748b",
            }}
          />
          <span
            className={`text-[10px] font-medium uppercase tracking-wider ${isRef ? "text-slate-500" : "text-slate-300"
              }`}
          >
            {layer}
            {isRef && (
              <span className="ml-1 text-[9px] lowercase italic text-slate-600">ref</span>
            )}
          </span>
        </button>

        {!isRef && isActive && (
          <button
            onClick={(e) => handleHop(e, layer)}
            className="p-0.5 hover:bg-white/10 rounded group"
            title={`Seek to start of ${layer}`}
          >
            <Target className="h-2.5 w-2.5 text-slate-500 group-hover:text-emerald-400 transition-colors" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      {cncLayers.length > 0 && (
        <div className="flex items-center gap-4">
          {cncLayers.map((l) => renderLayer(l, false))}
        </div>
      )}

      {refLayers.length > 0 && (
        <>
          {cncLayers.length > 0 && <div className="h-3 w-px bg-white/10" />}
          <div className="flex items-center gap-3">
            {refLayers.map((l) => renderLayer(l, true))}
          </div>
        </>
      )}

      {/* ── RAPIDS toggle ── */}
      {onToggleRapids && (
        <>
          <div className="h-3 w-px bg-white/10" />
          <button
            onClick={() => onToggleRapids(!showRapids)}
            className={`flex items-center gap-1.5 outline-none hover:text-white transition-all ${showRapids ? "opacity-100" : "opacity-40 hover:opacity-70"
              }`}
            title="Toggle rapid traverse moves (G0)"
          >
            <div
              className="w-3 h-3 rounded-[2px] shrink-0 border border-dashed"
              style={{
                backgroundColor: showRapids ? "#ef444440" : "transparent",
                borderColor: showRapids ? "#ef4444" : "#64748b",
              }}
            />
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Rapids
              <span className="ml-1 text-[9px] lowercase italic text-slate-600">G0</span>
            </span>
          </button>
        </>
      )}
    </div>
  )
}