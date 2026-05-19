import { X, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ButtonGroup } from "@/components/ui/button-group"

interface SequencePillProps {
  /** Display name of the layer (e.g. "CUT", "CUSTOM1") */
  layer: string
  /** CSS color for the layer pill accent */
  color: string
  /** Tool display string (e.g. "T7") */
  toolLabel: string
  /** Whether the pill is in a disabled state */
  disabled?: boolean
  /** Called when the X remove button is clicked */
  onRemove: () => void
  /** Called to reorder the pill to a new index */
  onReorder?: (newIndex: number) => void
  /** Total number of pills in sequence (for reorder dropdown) */
  totalCount?: number
  /** Current index of this pill in the sequence */
  currentIndex?: number
  /** Tool options for the tool selector dropdown */
  availableTools?: Array<{
    value: string
    label: string
    description?: string
  }>
  /** Currently selected tool value */
  currentToolValue?: string
  /** Called when a tool is selected from the dropdown */
  onToolChange?: (value: string) => void
}

export function SequencePill({
  layer,
  color,
  toolLabel,
  disabled = false,
  onRemove,
  onReorder,
  totalCount,
  currentIndex,
  availableTools,
  currentToolValue,
  onToolChange,
}: SequencePillProps) {
  const hasReorder = onReorder != null && totalCount != null && currentIndex != null
  const hasToolSelector = availableTools != null && onToolChange != null

  // Keyboard: Delete/Backspace removes
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      onRemove()
    }
  }

  return (
    <div className="group relative flex items-center" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Color accent bar — sits just left of the pill */}
      <div
        className="w-[2px] h-5 rounded-l-full shrink-0 -mr-px"
        style={{ backgroundColor: color }}
      />

      <ButtonGroup
        orientation="horizontal"
        className={cn(
          "rounded-full border bg-white/[0.06] border-white/10",
          "hover:bg-white/10 transition-colors select-none",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        {/* ── Layer name trigger: reorder position ── */}
        {hasReorder ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                className="h-6 flex items-center gap-1 px-1.5 rounded-l-full focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                style={{ color }}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {layer}
                </span>
                <ChevronDown className="h-2.5 w-2.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-[100px] bg-neutral-900 border-white/10"
            >
              {Array.from({ length: totalCount! }, (_, i) => (
                <DropdownMenuItem
                  key={i}
                  className={cn(
                    "flex items-center gap-1.5 cursor-pointer",
                    i === currentIndex ? "text-emerald-400" : "text-slate-300"
                  )}
                  disabled={i === currentIndex}
                  onClick={() => {
                    if (i !== currentIndex) onReorder!(i)
                  }}
                >
                  <span className="text-[9px] font-mono text-slate-500 w-3">{i + 1}.</span>
                  <span className="text-[10px] font-medium uppercase">{layer}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span
            className="h-6 flex items-center px-1.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color }}
          >
            {layer}
          </span>
        )}

        {/* ── Tool label trigger: select tool ── */}
        {hasToolSelector ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                className={cn(
                  "h-6 flex items-center gap-0.5 px-1.5 rounded-r-full",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500",
                  hasReorder ? "" : "rounded-l-full"
                )}
              >
                <span className="text-[9px] font-mono text-slate-500 tabular-nums">
                  {toolLabel}
                </span>
                <ChevronDown className="h-2.5 w-2.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[120px] bg-neutral-900 border-white/10"
            >
              {availableTools!.map((tool) => (
                <DropdownMenuItem
                  key={tool.value}
                  className={cn(
                    "flex items-center gap-1.5 cursor-pointer",
                    tool.value === currentToolValue ? "text-emerald-400" : "text-slate-300"
                  )}
                  onClick={() => onToolChange!(tool.value)}
                >
                  <span className="text-[10px] font-mono">{tool.label}</span>
                  {tool.description && (
                    <span className="text-[9px] text-slate-500 ml-1">— {tool.description}</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className={cn(
            "h-6 flex items-center px-1.5 text-[9px] font-mono text-slate-500 tabular-nums",
            !hasReorder && "rounded-l-full"
          )}>
            {toolLabel}
          </span>
        )}
      </ButtonGroup>

      {/* Hover-reveal X button */}
      <button
        className={cn(
          "absolute -right-1.5 -top-1.5 h-4 w-4 flex items-center justify-center",
          "rounded-full bg-black/80 border border-white/10",
          "text-slate-400 hover:text-red-400 hover:border-red-400/50",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "focus:opacity-100",
          disabled && "pointer-events-none"
        )}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        disabled={disabled}
        title={`Remove ${layer}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}