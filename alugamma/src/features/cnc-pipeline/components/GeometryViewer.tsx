// src/features/cnc-pipeline/components/GeometryViewer.tsx

import { useState, useMemo } from "react"
import type { GeometryResponse } from "../types"
import { LAYER_COLORS } from "./LayerControls"

interface Props {
  geometry:   GeometryResponse
  visible:    Record<string, boolean>
}

export function GeometryViewer({ geometry, visible }: Props) {
  const [hoveredSeq, setHoveredSeq] = useState<number | null>(null)

  const { segments, bbox } = geometry
  const { min_x, min_y, max_x, max_y } = bbox

  const viewW = max_x - min_x
  const viewH = max_y - min_y

  // Padding around the geometry inside the SVG
  const PAD = viewW * 0.03

  const viewBox = `${min_x - PAD} ${min_y - PAD} ${viewW + PAD * 2} ${viewH + PAD * 2}`

  const visibleSegments = useMemo(
    () => segments.filter((s) => visible[s.layer] !== false),
    [segments, visible]
  )

  const hoveredSegment = hoveredSeq !== null
    ? segments.find((s) => s.seq_index === hoveredSeq)
    : null

  const nextSeq = hoveredSeq !== null ? hoveredSeq + 1 : null
  const nextSegment = nextSeq !== null
    ? segments.find((s) => s.seq_index === nextSeq)
    : null

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Hover tooltip */}
      {hoveredSegment && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            background: "rgba(0,0,0,0.8)",
            color: "white",
            padding: "4px 8px",
            borderRadius: 4,
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 10,
            border: "1px solid rgba(255,255,255,0.1)"
          }}
        >
          <div>Segment #{hoveredSeq! + 1} — layer: {hoveredSegment.layer}</div>
          {nextSegment && <div>Next: #{nextSeq! + 1} — layer: {nextSegment.layer}</div>}
          {!nextSegment && nextSeq !== null && <div>Next: end of program</div>}
        </div>
      )}

      <svg
        viewBox={viewBox}
        style={{ width: "100%", height: "100%", display: "block", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "6px" }}
      >
        <g transform={`scale(1,-1) translate(0,${-(min_y + max_y)})`}>
          {visibleSegments.map((seg) => {
            const isHovered  = seg.seq_index === hoveredSeq
            const isNext     = seg.seq_index === nextSeq
            const color      = LAYER_COLORS[seg.layer] ?? "#ffffff"

            return (
              <line
                key={seg.seq_index}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke={isHovered ? "#ffffff" : isNext ? "#facc15" : color}
                strokeWidth={isHovered || isNext ? viewW * 0.005 : viewW * 0.002}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredSeq(seg.seq_index)}
                onMouseLeave={() => setHoveredSeq(null)}
              />
            )
          })}

          {/* Sequence number label on hovered segment midpoint */}
          {hoveredSegment && (
            <text
              x={(hoveredSegment.x1 + hoveredSegment.x2) / 2}
              y={(hoveredSegment.y1 + hoveredSegment.y2) / 2}
              fontSize={viewW * 0.012}
              fill="white"
              textAnchor="middle"
              // flip the text back upright since we flipped the group
              transform={`scale(1,-1) translate(0,${-(hoveredSegment.y1 + hoveredSegment.y2)})`}
            >
              #{hoveredSeq! + 1}
            </text>
          )}
        </g>
      </svg>
    </div>
  )
}
