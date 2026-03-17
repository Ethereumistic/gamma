import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast } from "lucide-react"

interface PlaybackControlsProps {
  isPlaying: boolean
  onTogglePlay: () => void
  currentLine: number
  totalLines: number
  onSeek: (line: number) => void
  speed: number
  onSpeedChange: (speed: number) => void
}

export function PlaybackControls({
  isPlaying,
  onTogglePlay,
  currentLine,
  totalLines,
  onSeek,
  speed,
  onSpeedChange,
}: PlaybackControlsProps) {
  return (
    <div className="flex items-center gap-4 w-full h-full">
      {/* Playback Buttons Group */}
      <div className="flex items-center gap-0.5 shrink-0 px-1 border-r border-white/10 pr-4">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 hover:bg-white/5" 
          onClick={() => onSeek(0)}
          title="To Start"
        >
          <ChevronFirst className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 hover:bg-white/5" 
          onClick={() => onSeek(Math.max(0, currentLine - 1))}
          title="Previous Line"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="icon" 
          className="h-8 w-8 bg-black/40 border-white/10 hover:bg-white/5 hover:text-emerald-400" 
          onClick={onTogglePlay}
        >
          {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current translate-x-0.5" />}
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 hover:bg-white/5" 
          onClick={() => onSeek(Math.min(totalLines - 1, currentLine + 1))}
          title="Next Line"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 hover:bg-white/5" 
          onClick={() => onSeek(totalLines - 1)}
          title="To End"
        >
          <ChevronLast className="h-4 w-4" />
        </Button>
      </div>

      {/* Timeline Section */}
      <div className="flex-1 flex items-center gap-4 min-w-0">
        <div className="shrink-0 font-mono text-[10px] text-muted-foreground w-20 text-right">
          {currentLine} / {Math.max(0, totalLines - 1)}
        </div>
        <Slider
          value={[currentLine]}
          max={Math.max(0, totalLines - 1)}
          step={1}
          onValueChange={(val) => onSeek(val[0])}
          className="flex-1 py-1"
        />
      </div>

      {/* Speed Control Section */}
      <div className="flex items-center gap-3 shrink-0 pl-4 border-l border-white/10">
        <span className="text-[10px] uppercase font-bold text-muted-foreground/60">Speed</span>
        <Slider
          value={[speed]}
          min={1}
          max={100}
          step={1}
          onValueChange={(val) => onSpeedChange(val[0])}
          className="w-24"
        />
        <span className="text-[10px] font-mono text-emerald-400 tabular-nums w-8">{speed}x</span>
      </div>
    </div>
  )
}
