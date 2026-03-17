import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { downloadURL } from "../api"
import { Check, Copy, Download } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  ncText: string
  jobId: string
  currentLineIndex?: number
  onLineClick?: (index: number) => void
}

export function NCPreview({ ncText, jobId, currentLineIndex, onLineClick }: Props) {
  const [copied, setCopied] = useState(false)
  const lines = ncText.trimEnd().split("\n")
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])

  const handleCopy = () => {
    navigator.clipboard.writeText(ncText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    if (currentLineIndex !== undefined && lineRefs.current[currentLineIndex]) {
      lineRefs.current[currentLineIndex]?.scrollIntoView({
        behavior: 'auto', // Auto is better for rapid synchronization to avoid jitter
        block: 'center'
      })
    }
  }, [currentLineIndex])

  return (
    <Card className="bg-transparent border-white/10 flex flex-col h-full shadow-none overflow-hidden">
      <CardHeader className="py-2.5 px-4 border-b border-white/5 flex flex-row items-center justify-between space-y-0 shrink-0">
        <div className="flex items-baseline gap-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">NC Code</CardTitle>
          <span className="text-[10px] text-slate-500">{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-white/5" onClick={handleCopy} title="Copy code">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-white/5" asChild title="Download .nc">
            <a href={downloadURL(jobId)} download>
              <Download className="h-3.5 w-3.5 text-slate-400" />
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0 relative min-h-0">
        <ScrollArea className="absolute inset-0 w-full h-full bg-black/20">
          <div className="py-2">
            <pre className="text-[11px] leading-tight font-mono text-slate-300">
              {lines.map((line, i) => (
                <div 
                  key={i} 
                  ref={el => lineRefs.current[i] = el}
                  onClick={() => onLineClick?.(i)}
                  className={cn(
                    "px-4 py-0.5 cursor-pointer transition-colors hover:bg-white/5",
                    currentLineIndex === i ? "bg-emerald-500/20 text-emerald-300 font-bold border-l-2 border-emerald-500" : "border-l-2 border-transparent"
                  )}
                >
                  <span className="inline-block w-8 shrink-0 text-slate-600 select-none mr-4">{i + 1}</span>
                  {line}
                </div>
              ))}
            </pre>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </CardContent>
    </Card>
  )
}