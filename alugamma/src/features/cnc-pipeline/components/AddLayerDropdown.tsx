import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface AddLayerDropdownProps {
  /** Layers available to add (not yet in the sequence) */
  availableLayers: Array<{
    layer: string
    color: string
    /** Suggested tool label e.g. "T7" */
    toolLabel: string
  }>
  /** Called when user selects a layer to add */
  onAddLayer: (layer: string) => void
  /** Whether the dropdown is disabled */
  disabled?: boolean
}

export function AddLayerDropdown({
  availableLayers,
  onAddLayer,
  disabled = false,
}: AddLayerDropdownProps) {
  const hasLayers = availableLayers.length > 0
  const isDisabled = disabled || !hasLayers

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "h-6 w-6 flex items-center justify-center rounded-full",
            "border border-dashed border-white/20 bg-white/[0.06]",
            "hover:bg-white/10 hover:border-white/30 transition-colors",
            isDisabled && "opacity-30 pointer-events-none"
          )}
          disabled={isDisabled}
          title={hasLayers ? "Add layer to sequence" : "No layers to add"}
        >
          <Plus className="h-3 w-3 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[140px] bg-neutral-900 border-white/10"
      >
        {availableLayers.map((item) => (
          <DropdownMenuItem
            key={item.layer}
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => onAddLayer(item.layer)}
            disabled={disabled}
          >
            <div
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: item.color }}
            >
              {item.layer}
            </span>
            <span className="text-[9px] font-mono text-slate-500 ml-auto">
              {item.toolLabel}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}