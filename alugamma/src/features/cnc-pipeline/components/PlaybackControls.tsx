import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Play, Pause, SkipBack, SkipForward } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  isPlaying: boolean
  onTogglePlay: () => void
  currentLine: number
  totalLines: number
  onSeek: (line: number) => void
  speed: number
  onSpeedChange: (speed: number) => void
  layers: string[]
  visibleLayers: Record<string, boolean>
  onToggleLayer: (layer: string, visible: boolean) => void
}

export function PlaybackControls({
  isPlaying,
  onTogglePlay,
  currentLine,
  totalLines,
  onSeek,
  speed,
  onSpeedChange,
  layers,
  visibleLayers,
  onToggleLayer
}: Props) {
  return (
    <div className="bg-black/40 border border-white/10 rounded-lg p-3 flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {/* Playback Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 hover:bg-white/5" 
            onClick={() => onSeek(Math.max(0, currentLine - 1))}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button 
            variant="outline" 
            size="icon" 
            className="h-9 w-9 bg-black/40 border-white/10 hover:bg-white/5 hover:text-emerald-400" 
            onClick={onTogglePlay}
          >
            {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current translate-x-0.5" />}
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 hover:bg-white/5" 
            onClick={() => onSeek(Math.min(totalLines - 1, currentLine + 1))}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Timeline Slider */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono tracking-tighter uppercase font-bold">
            <span>Line {currentLine} / {Math.max(0, totalLines - 1)}</span>
            <span className={isPlaying ? "text-emerald-500 animate-pulse" : ""}>
              {isPlaying ? 'Simulation Running' : 'Simulation Paused'}
            </span>
          </div>
          <Slider
            value={[currentLine]}
            max={Math.max(0, totalLines - 1)}
            step={1}
            onValueChange={(val) => onSeek(val[0])}
            className="py-1"
          />
        </div>
      </div>

      <div className="flex items-center gap-6 border-t border-white/5 pt-3">
        {/* Speed Slider */}
        <div className="flex items-center gap-3 flex-1">
          <span className="text-[10px] uppercase font-bold text-muted-foreground/60 w-10">Speed</span>
          <Slider
            value={[speed]}
            min={1}
            max={100}
            step={1}
            onValueChange={(val) => onSpeedChange(val[0])}
            className="max-w-[120px]"
          />
          <span className="text-[10px] font-mono text-emerald-400 tabular-nums w-8">{speed}x</span>
        </div>

        {/* Layer Toggles (Simplified for Playback) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[10px] uppercase font-bold text-muted-foreground/60 mr-1">Toggles</span>
          {layers.filter(l => ["CUT", "FREZ", "FREZ_135", "HOLES"].includes(l)).map(layer => (
            <Button
              key={layer}
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-[9px] font-bold uppercase tracking-tight transition-all",
                visibleLayers[layer] 
                  ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" 
                  : "bg-white/5 text-slate-500 hover:bg-white/10"
              )}
              onClick={() => onToggleLayer(layer, !visibleLayers[layer])}
            >
              {layer}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
