// src/features/cnc-pipeline/components/GeometryViewer.tsx

import { useState, useMemo, useRef } from "react"
import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch"
import type { GeometryResponse } from "../types"
import { LAYER_COLORS } from "./LayerControls"

interface Props {
    geometry: GeometryResponse
    visible: Record<string, boolean>
    currentLineIndex?: number
    lineToSegmentMap?: Record<number, number>
}

// Layers that participate in CNC toolpath generation.
// All others are rendered as reference-only (dimmed) when toggled on.
const CNC_LAYERS = new Set(["CUT", "FREZ", "FREZ_135", "HOLES"])

// ─── Inner controls component (must live inside TransformWrapper) ─────────────
function ZoomControls() {
    const { zoomIn, zoomOut, resetTransform } = useControls()
    const btnStyle: React.CSSProperties = {
        background: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.15)",
        color: "#e2e8f0",
        width: 32,
        height: 32,
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.15s",
        fontFamily: "monospace",
    }
    return (
        <div
            style={{
                position: "absolute",
                bottom: 12,
                right: 12,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                zIndex: 20,
            }}
        >
            <button style={btnStyle} onClick={() => zoomIn()} title="Zoom in">＋</button>
            <button style={btnStyle} onClick={() => zoomOut()} title="Zoom out">－</button>
            <button
                style={{ ...btnStyle, fontSize: 13, letterSpacing: "-0.5px" }}
                onClick={() => resetTransform()}
                title="Reset / center view"
            >
                ⊙
            </button>
        </div>
    )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function GeometryViewer({ geometry, visible, currentLineIndex, lineToSegmentMap }: Props) {
    const [hoveredSeq, setHoveredSeq] = useState<number | null>(null)

    const { segments, bbox } = geometry
    const { min_x, min_y, max_x, max_y } = bbox

    const viewW = max_x - min_x
    const viewH = max_y - min_y
    const PAD = viewW * 0.03

    const viewBox = `${min_x - PAD} ${min_y - PAD} ${viewW + PAD * 2} ${viewH + PAD * 2}`

    const activeSeqIndex = useMemo(() => {
        if (currentLineIndex === undefined || !lineToSegmentMap) return null
        return lineToSegmentMap[currentLineIndex] ?? null
    }, [currentLineIndex, lineToSegmentMap])

    const visibleSegments = useMemo(
        () => segments.filter((s) => (visible[s.layer] ?? true) !== false),
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
        <div style={{ position: "relative", width: "100%", height: "100%", backgroundColor: "#000" }}>

            {/* ── Hover tooltip ── */}
            {hoveredSegment && (
                <div
                    style={{
                        position: "absolute",
                        top: 8,
                        left: 8,
                        background: "rgba(0,0,0,0.85)",
                        color: "white",
                        padding: "5px 10px",
                        borderRadius: 5,
                        fontSize: 12,
                        pointerEvents: "none",
                        zIndex: 30,
                        border: "1px solid rgba(255,255,255,0.12)",
                        lineHeight: 1.6,
                    }}
                >
                    <div>
                        Segment #{hoveredSeq! + 1}
                        {" — "}
                        <span style={{ color: LAYER_COLORS[hoveredSegment.layer] ?? "#fff" }}>
                            {hoveredSegment.layer}
                        </span>
                        {!CNC_LAYERS.has(hoveredSegment.layer) && (
                            <span style={{ color: "#94a3b8", marginLeft: 6, fontSize: 11 }}>(ref only)</span>
                        )}
                    </div>
                    {nextSegment && (
                        <div style={{ color: "#94a3b8" }}>
                            Next: #{nextSeq! + 1} —{" "}
                            <span style={{ color: LAYER_COLORS[nextSegment.layer] ?? "#fff" }}>
                                {nextSegment.layer}
                            </span>
                        </div>
                    )}
                    {!nextSegment && nextSeq !== null && (
                        <div style={{ color: "#94a3b8" }}>Next: end of program</div>
                    )}
                </div>
            )}

            {/* ── Zoom / pan wrapper ── */}
            <TransformWrapper
                initialScale={1}
                minScale={0.1}
                maxScale={40}
                doubleClick={{ disabled: false }}
                wheel={{ step: 0.08 }}
                panning={{ velocityDisabled: true }}
                limitToBounds={false}
            >
                {/* ZoomControls must be inside TransformWrapper to access context */}
                <>
                    <TransformComponent
                        wrapperStyle={{ width: "100%", height: "100%" }}
                        contentStyle={{ width: "100%", height: "100%" }}
                    >
                        <svg
                            viewBox={viewBox}
                            style={{
                                width: "100%",
                                height: "100%",
                                display: "block",
                                backgroundColor: "#000000",
                                borderRadius: "6px",
                            }}
                        >
                            <g transform={`scale(1,-1) translate(0,${-(min_y + max_y)})`}>

                                {visibleSegments.map((seg) => {
                                    const isHovered = seg.seq_index === hoveredSeq
                                    const isActive = activeSeqIndex !== null && seg.seq_index === activeSeqIndex
                                    const isPast = activeSeqIndex !== null && seg.seq_index < activeSeqIndex
                                    const isCncLayer = CNC_LAYERS.has(seg.layer)
                                    const baseColor = LAYER_COLORS[seg.layer] ?? "#ffffff"

                                    // 1. Determine Stroke Color
                                    let strokeColor = baseColor
                                    if (isHovered) {
                                        strokeColor = "#ffffff"
                                    } else if (isActive) {
                                        strokeColor = "#ffffff" // Or bright yellow/green
                                    } else if (!isCncLayer) {
                                        strokeColor = baseColor + "55"
                                    } else if (isPast) {
                                        strokeColor = baseColor // Solid color for cut pieces
                                    } else if (activeSeqIndex !== null) {
                                        strokeColor = baseColor + "44" // Dimmed for future
                                    }

                                    // 2. Determine Stroke Width
                                    let strokeW = viewW * 0.002
                                    if (isHovered || isActive) {
                                        strokeW = viewW * 0.008
                                    } else if (!isCncLayer) {
                                        strokeW = viewW * 0.0015
                                    } else if (isPast) {
                                        strokeW = viewW * 0.003
                                    }

                                    return (
                                        <line
                                          key={seg.seq_index}
                                          x1={seg.x1}
                                          y1={seg.y1}
                                          x2={seg.x2}
                                          y2={seg.y2}
                                          stroke={strokeColor}
                                          strokeWidth={strokeW}
                                          strokeDasharray={!isCncLayer && !isHovered ? `${viewW * 0.008} ${viewW * 0.005}` : undefined}
                                          style={{ cursor: "pointer", transition: "stroke 0.1s, stroke-width 0.1s" }}
                                          onMouseEnter={() => setHoveredSeq(seg.seq_index)}
                                          onMouseLeave={() => setHoveredSeq(null)}
                                        />
                                    )
                                })}

                                {/* Sequence label on hovered segment midpoint */}
                                {hoveredSegment && (
                                    <text
                                        x={(hoveredSegment.x1 + hoveredSegment.x2) / 2}
                                        y={(hoveredSegment.y1 + hoveredSegment.y2) / 2}
                                        fontSize={viewW * 0.012}
                                        fill="white"
                                        textAnchor="middle"
                                        transform={`scale(1,-1) translate(0,${-(hoveredSegment.y1 + hoveredSegment.y2)})`}
                                    >
                                        #{hoveredSeq! + 1}
                                    </text>
                                )}

                                {/* Active segment indicator (Optional: Moving dot or similar) */}
                                {activeSeqIndex !== null && (
                                    <circle
                                        cx={segments.find(s => s.seq_index === activeSeqIndex)?.x2}
                                        cy={segments.find(s => s.seq_index === activeSeqIndex)?.y2}
                                        r={viewW * 0.008}
                                        fill="#fbbf24"
                                        className="animate-pulse"
                                    />
                                )}
                            </g>
                        </svg>
                    </TransformComponent>

                    <ZoomControls />
                </>
            </TransformWrapper>

            {/* ── Legend: reference-only indicator ── */}
            <div
                style={{
                    position: "absolute",
                    bottom: 12,
                    left: 12,
                    fontSize: 11,
                    color: "#64748b",
                    pointerEvents: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    zIndex: 20,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <svg width="20" height="2">
                        <line x1="0" y1="1" x2="20" y2="1" stroke="#ffffff" strokeWidth="1.5" />
                    </svg>
                    <span style={{ color: "#94a3b8" }}>CNC active</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <svg width="20" height="2">
                        <line x1="0" y1="1" x2="20" y2="1" stroke="#ffffff55" strokeWidth="1.5" strokeDasharray="4 3" />
                    </svg>
                    <span>Reference only</span>
                </div>
            </div>
        </div>
    )
}