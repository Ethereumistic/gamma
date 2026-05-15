import { useState, useMemo, useRef } from "react"
import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch"
import { GeometryResponse, Segment } from "../types"
import { LAYER_COLORS, getLayerColor } from "./LayerControls"
import { motion } from "motion/react"

// ─── Physics constants (mirrored from usePlayback) ────────────────────────────
const CUT_SPEED_MM_PER_S = 5500 / 60    // 91.667 mm/s
const RAPID_SPEED_MM_PER_S = 18000 / 60   // 300 mm/s

// ─── Types ────────────────────────────────────────────────────────────────────
interface RapidSegment {
    id: string
    x1: number; y1: number
    x2: number; y2: number
    fromSeq: number   // seq_index of the cut that ends here (-1 = machine home)
    toSeq: number     // seq_index of the cut that starts here
}

interface Props {
    geometry: GeometryResponse
    visible: Record<string, boolean>
    showRapids?: boolean
    currentLineIndex?: number
    lineToSegmentMap?: Record<number, number>
    segmentToLineMap?: Record<number, number>
    onSeek?: (line: number) => void
    playbackSpeed?: number
    rapidSpeedMultiplier?: number
    seekTrigger?: number
    ncLines?: string[]
    isPlaying?: boolean
    traceMode?: Record<string, boolean>
    /** Which layers are CNC-active (part of toolpath sequence). Defaults to built-in set. */
    cncLayerNames?: Set<string>
}

// Layers that participate in CNC toolpath generation.
// Default set — can be overridden via `cncLayerNames` prop.
const DEFAULT_CNC_LAYERS = new Set(["CUT", "FREZ", "FREZ_135", "HOLES"])

// ─── Inner zoom-controls component (must live inside TransformWrapper) ────────
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
export function GeometryViewer({
    geometry,
    visible,
    showRapids = true,
    currentLineIndex,
    lineToSegmentMap,
    segmentToLineMap,
    onSeek,
    playbackSpeed = 1,
    rapidSpeedMultiplier = 1,
    seekTrigger = 0,
    ncLines,
    isPlaying = false,
    traceMode,
    cncLayerNames,
}: Props) {
    const CNC_LAYERS = cncLayerNames ?? DEFAULT_CNC_LAYERS
    const [hoveredSeq, setHoveredSeq] = useState<number | null>(null)

    const { segments, bbox } = geometry
    const { min_x, min_y, max_x, max_y } = bbox

    const viewW = max_x - min_x
    const viewH = max_y - min_y
    const PAD = viewW * 0.03

    const viewBox = `${min_x - PAD} ${min_y - PAD} ${viewW + PAD * 2} ${viewH + PAD * 2}`

    // ── Active seq index from the current G-code line ─────────────────────────
    const activeSeqIndex = useMemo(() => {
        if (currentLineIndex === undefined || !lineToSegmentMap) return null
        return lineToSegmentMap[currentLineIndex] ?? null
    }, [currentLineIndex, lineToSegmentMap])

    // ── lastKnownSeqRef: only advances forward, never snaps back to null ───────
    // This is the key to eliminating geometry flicker: all highlight logic uses
    // this stable value instead of the raw activeSeqIndex.
    const lastKnownSeqRef = useRef<number | null>(null)
    if (activeSeqIndex !== null) {
        const seg = segments.find(s => s.seq_index === activeSeqIndex)
        if (seg && CNC_LAYERS.has(seg.layer)) {
            lastKnownSeqRef.current = activeSeqIndex
        }
    }
    const stableActiveSeq = activeSeqIndex ?? lastKnownSeqRef.current

    // ── Visible segments (layer visibility filter) ────────────────────────────
    const visibleSegments = useMemo(
        () => segments.filter((s) => (visible[s.layer] ?? true) !== false),
        [segments, visible]
    )

    // ── Derive rapid segments from CNC segments only ─────────────────────────
    // Rapids connect the end of one cut to the start of the next regardless of
    // layer visibility, so we use the CNC segments ONLY sorted by seq_index.
    const rapidSegments = useMemo((): RapidSegment[] => {
        const rapids: RapidSegment[] = []
        const sorted = [...segments]
            .filter(s => CNC_LAYERS.has(s.layer))
            .sort((a, b) => a.seq_index - b.seq_index)

        if (sorted.length === 0) return rapids

        // Initial rapid: machine home (0,0) → first cut start
        if (Math.hypot(sorted[0].x1, sorted[0].y1) > 0.001) {
            rapids.push({
                id: "rapid-home",
                x1: 0, y1: 0,
                x2: sorted[0].x1, y2: sorted[0].y1,
                fromSeq: -1,
                toSeq: sorted[0].seq_index,
            })
        }

        for (let i = 0; i < sorted.length - 1; i++) {
            const curr = sorted[i]
            const next = sorted[i + 1]
            if (Math.hypot(next.x1 - curr.x2, next.y1 - curr.y2) > 0.001) {
                rapids.push({
                    id: `rapid-${curr.seq_index}-${next.seq_index}`,
                    x1: curr.x2, y1: curr.y2,
                    x2: next.x1, y2: next.y1,
                    fromSeq: curr.seq_index,
                    toSeq: next.seq_index,
                })
            }
        }
        return rapids
    }, [segments])

    // ── Which rapid is currently in-flight? ───────────────────────────────────
    // A rapid is active when activeSeqIndex is null (we're between cuts) and the
    // last known seq index matches the rapid's fromSeq.
    const activeRapid = useMemo((): RapidSegment | null => {
        if (activeSeqIndex !== null) return null
        const refSeq = lastKnownSeqRef.current
        if (refSeq === null) {
            // We haven't hit any segment yet — check for the home rapid
            const homeRapid = rapidSegments.find(r => r.fromSeq === -1)
            return homeRapid ?? null
        }
        return rapidSegments.find(r => r.fromSeq === refSeq) ?? null
    }, [activeSeqIndex, rapidSegments])

    // ── Active / next cut segment ─────────────────────────────────────────────
    const activeSegment = activeSeqIndex !== null
        ? segments.find(s => s.seq_index === activeSeqIndex && CNC_LAYERS.has(s.layer)) ?? null
        : null

    // ── Info card: what to show when hovering or during playback ─────────────
    // Use stableActiveSeq so the card doesn't flicker during rapids/headers
    const displaySeq = hoveredSeq !== null ? hoveredSeq : stableActiveSeq
    const displaySegment = displaySeq !== null
        ? segments.find((s) => s.seq_index === displaySeq) ?? null
        : null

    const nextSeq = displaySeq !== null ? displaySeq + 1 : null
    const nextSegment = nextSeq !== null
        ? segments.find((s) => s.seq_index === nextSeq) ?? null
        : null

    // ── Classify the current raw G-code line for the card header ─────────────
    const currentRawLine = ncLines?.[currentLineIndex ?? 0] ?? ""
    const lineType = useMemo((): "cutting" | "rapid" | "tool-change" | "header" | "dwell" => {
        if (!currentRawLine) return "header"
        const l = currentRawLine.trim().toUpperCase()
        if (l.startsWith("T") || l.includes("M6") || l.includes("M06")) return "tool-change"
        if (l.startsWith("G0 ") || l.startsWith("G00 ") || l === "G0" || l === "G00") return "rapid"
        if (l.startsWith("G1 ") || l.startsWith("G01 ") || l === "G1" || l === "G01") return "cutting"
        if (l.startsWith("G4") || l.startsWith("G04")) return "dwell"
        return "header"
    }, [currentRawLine])

    // ── Card is shown once playback has started, or when hovering ─────────────
    const hasStarted = (currentLineIndex ?? 0) > 0 || isPlaying

    // ── Dot animation target ──────────────────────────────────────────────────
    // Always resolves to a valid position; never causes the dot to unmount.
    const committedDotRef = useRef<{ x: number; y: number; duration: number; isRapid: boolean } | null>(null)
    const lastCommittedSeqRef = useRef<number | null>(null)
    const lastCommittedRapidIdRef = useRef<string | null>(null)

    const dotTarget = useMemo(() => {
        // Priority 1: a cut segment is actively mapped to current line
        if (activeSegment) {
            // Only update if this is a new segment (avoid resetting mid-animation)
            if (lastCommittedSeqRef.current !== activeSegment.seq_index) {
                lastCommittedSeqRef.current = activeSegment.seq_index
                lastCommittedRapidIdRef.current = null
                const len = Math.hypot(activeSegment.x2 - activeSegment.x1, activeSegment.y2 - activeSegment.y1)
                committedDotRef.current = {
                    x: activeSegment.x2,
                    y: activeSegment.y2,
                    duration: Math.max(0.016, len / (CUT_SPEED_MM_PER_S * playbackSpeed)),
                    isRapid: false,
                }
            }
            return committedDotRef.current
        }

        // Priority 2: we're on a rapid move (activeSeqIndex is null, activeRapid found)
        if (activeRapid) {
            // Only commit the rapid if we've already committed (and presumably finished)
            // the cut that precedes it — i.e. lastCommittedSeqRef === activeRapid.fromSeq
            const prerequisiteMet =
                activeRapid.fromSeq === -1 ||                              // home rapid, always OK
                lastCommittedSeqRef.current === activeRapid.fromSeq        // previous cut was committed

            if (prerequisiteMet && lastCommittedRapidIdRef.current !== activeRapid.id) {
                lastCommittedRapidIdRef.current = activeRapid.id
                const len = Math.hypot(activeRapid.x2 - activeRapid.x1, activeRapid.y2 - activeRapid.y1)
                committedDotRef.current = {
                    x: activeRapid.x2,
                    y: activeRapid.y2,
                    duration: Math.max(0.016, len / (RAPID_SPEED_MM_PER_S * rapidSpeedMultiplier)),
                    isRapid: true,
                }
            }
            return committedDotRef.current
        }

        // Priority 3: hold last committed position
        return committedDotRef.current
    }, [activeSegment, activeRapid, playbackSpeed, rapidSpeedMultiplier])

    const initialDot = useMemo(() => {
        if (activeSegment) return { cx: activeSegment.x1, cy: activeSegment.y1 }
        if (activeRapid) return { cx: activeRapid.x1, cy: activeRapid.y1 }
        return null
    }, [seekTrigger]) // Only update initial position when seeking occurs

    const handleSegmentClick = (seq: number) => {
        if (segmentToLineMap && onSeek) {
            const line = segmentToLineMap[seq]
            if (line !== undefined) onSeek(line)
        }
    }

    // ── Card label ────────────────────────────────────────────────────────────
    const cardLabel = hoveredSeq !== null
        ? "Inspecting"
        : activeRapid
            ? "Rapid Move"
            : lineType === "cutting" ? "Machining"
                : lineType === "tool-change" ? "Tool Change"
                    : lineType === "dwell" ? "Dwell"
                        : stableActiveSeq !== null ? "Machining"
                            : "Program"

    return (
        <div style={{ position: "relative", width: "100%", height: "100%", backgroundColor: "#000" }}>

            {/* ── Info card — always visible once started ── */}
            {(hasStarted || hoveredSeq !== null) && (
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
                        minWidth: 160,
                    }}
                >
                    <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                        {cardLabel}
                    </div>

                    {displaySegment ? (
                        <>
                            <div>
                                Segment #{displaySeq! + 1}
                                {" — "}
                                <span style={{ color: getLayerColor(displaySegment.layer) }}>
                                    {displaySegment.layer}
                                </span>
                                {!CNC_LAYERS.has(displaySegment.layer) && (
                                    <span style={{ color: "#94a3b8", marginLeft: 6, fontSize: 11 }}>(ref only)</span>
                                )}
                            </div>
                            {nextSegment && (
                                <div style={{ color: "#94a3b8" }}>
                                    Next: #{nextSeq! + 1} —{" "}
                                    <span style={{ color: getLayerColor(nextSegment.layer) }}>
                                        {nextSegment.layer}
                                    </span>
                                </div>
                            )}
                        </>
                    ) : (
                        /* Fallback: show the raw G-code line so card never goes blank */
                        <div style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 11 }}>
                            {currentRawLine ? currentRawLine.trim().slice(0, 52) : "—"}
                        </div>
                    )}

                    {/* Rapid destination coordinates */}
                    {activeRapid && hoveredSeq === null && (
                        <div style={{ color: "#ef4444", fontSize: 11, marginTop: 2 }}>
                            → ({activeRapid.x2.toFixed(2)}, {activeRapid.y2.toFixed(2)})
                        </div>
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

                                {/* ── Rapid move lines (rendered beneath cut lines) ── */}
                                {showRapids && rapidSegments.map((r) => {
                                    const isActiveRapid = activeRapid?.id === r.id

                                    // Trace mode for rapids: only show rapids that have already been traversed
                                    const rapidTraceModeOn = traceMode?.["RAPIDS"] ?? false
                                    if (rapidTraceModeOn) {
                                        // A rapid is "past" if its toSeq <= stableActiveSeq (the tool has started the next cut)
                                        const isPastRapid = stableActiveSeq !== null && r.toSeq <= stableActiveSeq
                                        if (!isPastRapid && !isActiveRapid) return null
                                    }

                                    return (
                                        <line
                                            key={r.id}
                                            x1={r.x1} y1={r.y1}
                                            x2={r.x2} y2={r.y2}
                                            stroke="#ef4444"
                                            strokeWidth={isActiveRapid ? viewW * 0.005 : viewW * 0.0012}
                                            strokeDasharray={`${viewW * 0.007} ${viewW * 0.004}`}
                                            opacity={isActiveRapid ? 0.85 : 0.3}
                                            style={{ pointerEvents: "none" }}
                                        />
                                    )
                                })}

                                {/* ── Cut segments ── */}
                                {visibleSegments.map((seg) => {
                                    const isTracedLayer   = traceMode?.[seg.layer] ?? false
                                    const isTracedVisible = !isTracedLayer || (stableActiveSeq !== null && seg.seq_index <= stableActiveSeq)
                                    if (!isTracedVisible) return null

                                    const isHovered = seg.seq_index === hoveredSeq
                                    // Use stableActiveSeq so highlighting never flickers
                                    // when the playhead is on a non-geometry line
                                    const isActive = stableActiveSeq !== null && seg.seq_index === stableActiveSeq
                                    const isPast = stableActiveSeq !== null && seg.seq_index < stableActiveSeq
                                    const isCncLayer = CNC_LAYERS.has(seg.layer)
                                    const baseColor = getLayerColor(seg.layer)

                                    let strokeColor = baseColor
                                    if (isHovered) {
                                        strokeColor = "#ffffff"
                                    } else if (isActive) {
                                        strokeColor = "#ffffff"
                                    } else if (!isCncLayer) {
                                        strokeColor = baseColor + "55"
                                    } else if (isPast) {
                                        strokeColor = baseColor
                                    } else if (stableActiveSeq !== null) {
                                        strokeColor = baseColor + "44"
                                    }

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
                                            x1={seg.x1} y1={seg.y1}
                                            x2={seg.x2} y2={seg.y2}
                                            stroke={strokeColor}
                                            strokeWidth={strokeW}
                                            strokeDasharray={!isCncLayer && !isHovered ? `${viewW * 0.008} ${viewW * 0.005}` : undefined}
                                            style={{ cursor: "pointer", transition: "stroke 0.1s, stroke-width 0.1s" }}
                                            onMouseEnter={() => setHoveredSeq(seg.seq_index)}
                                            onMouseLeave={() => setHoveredSeq(null)}
                                            onClick={() => handleSegmentClick(seg.seq_index)}
                                        />
                                    )
                                })}

                                {/* ── Hovered segment label ── */}
                                {hoveredSeq !== null && displaySegment && (
                                    <text
                                        x={(displaySegment.x1 + displaySegment.x2) / 2}
                                        y={(displaySegment.y1 + displaySegment.y2) / 2}
                                        fontSize={viewW * 0.012}
                                        fill="white"
                                        textAnchor="middle"
                                        transform={`scale(1,-1) translate(0,${-(displaySegment.y1 + displaySegment.y2)})`}
                                    >
                                        #{hoveredSeq + 1}
                                    </text>
                                )}

                                {/* ── Tool dot — rendered unconditionally once started ── */}
                                {/* key is stable but resets on seek so Framer Motion remounts/snaps */}
                                {hasStarted && dotTarget && (
                                    <motion.circle
                                        key={`tool-dot-${seekTrigger}`}
                                        initial={initialDot ? { cx: initialDot.cx, cy: initialDot.cy } : false}
                                        animate={{ cx: dotTarget.x, cy: dotTarget.y }}
                                        transition={{
                                            duration: dotTarget.duration,
                                            ease: "linear",
                                        }}
                                        r={viewW * 0.008}
                                        fill={dotTarget.isRapid ? "#f87171" : "#fbbf24"}
                                        style={{ pointerEvents: "none" }}
                                    />
                                )}

                            </g>
                        </svg>
                    </TransformComponent>

                    <ZoomControls />
                </>
            </TransformWrapper>
        </div>
    )
}