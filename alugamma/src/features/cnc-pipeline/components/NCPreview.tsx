// src/features/cnc-pipeline/components/NCPreview.tsx

import { Button } from "@/components/ui/button"
import { downloadURL } from "../api"

interface Props {
  ncText:  string
  jobId:   string
  onReset: () => void
}

export function NCPreview({ ncText, jobId, onReset }: Props) {
  const lines = ncText.split("\n")

  return (
    <div>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem" }}>
        <a href={downloadURL(jobId)} download>
          <Button>Download .nc</Button>
        </a>
        <Button variant="outline" onClick={onReset} className="border-white/10 hover:bg-white/5">
          Generate another
        </Button>
        <span style={{ fontSize: 12, opacity: 0.6, alignSelf: "center" }}>
          {lines.length} lines
        </span>
      </div>
      <pre
        style={{
          height: 400,
          overflowY: "auto",
          fontSize: 12,
          lineHeight: 1.5,
          padding: "0.5rem",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 4,
          backgroundColor: "rgba(0,0,0,0.5)",
          color: "#e2e8f0"
        }}
      >
        {ncText}
      </pre>
    </div>
  )
}
