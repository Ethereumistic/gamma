import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Segment } from "../types";

// ─── Physics constants ────────────────────────────────────────────────────────
const CUT_SPEED_MM_PER_S = 5500 / 60;   // 91.667 mm/s  — G1 feed rate
const RAPID_SPEED_MM_PER_S = 18000 / 60;  // 300 mm/s     — G0 rapid traverse
const DWELL_DURATION_S = 0.04;         // non-geometry lines (headers, M-codes, tool changes)

export function usePlayback(
  ncLines: string[],
  segments: Segment[],
  lineToSegmentMap: Record<number, number>,
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentSimTime, setCurrentSimTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [rapidPlaybackSpeed, setRapidPlaybackSpeed] = useState(1.0);
  const [seekTrigger, setSeekTrigger] = useState(0);
  const [activeLayers, setActiveLayers] = useState<string[]>([]);

  // ── Build per-line duration table (seconds at speed=1) ──────────────────────
  const lineDurations = useMemo(() => {
    const maxLines = ncLines.length;
    const durations = new Float64Array(maxLines);
    durations.fill(DWELL_DURATION_S);

    const linesPerSeq = new Map<number, number>();
    const seqToLines = new Map<number, number[]>();
    for (let i = 0; i < maxLines; i++) {
      const seq = lineToSegmentMap[i];
      if (seq !== undefined) {
        linesPerSeq.set(seq, (linesPerSeq.get(seq) || 0) + 1);
        if (!seqToLines.has(seq)) seqToLines.set(seq, []);
        seqToLines.get(seq)!.push(i);
      }
    }

    const segBySeq = new Map(segments.map((s) => [s.seq_index, s]));

    // 1. Cut Durations
    for (let i = 0; i < maxLines; i++) {
        const seq = lineToSegmentMap[i];
        if (seq !== undefined) {
            const seg = segBySeq.get(seq);
            if (seg) {
                const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                const totalDur = len > 0 ? len / CUT_SPEED_MM_PER_S : DWELL_DURATION_S;
                durations[i] = totalDur / linesPerSeq.get(seq)!;
            }
        }
    }

    // 2. Rapid Durations (G0)
    const CNC_LAYERS = new Set(["CUT", "FREZ", "FREZ_135", "HOLES"]);
    const sortedSegs = [...segments]
      .filter(s => CNC_LAYERS.has(s.layer))
      .sort((a,b) => a.seq_index - b.seq_index);

    let lastLineExtracted = -1;
    let lastX = 0, lastY = 0;

    for (const seg of sortedSegs) {
      const lines = seqToLines.get(seg.seq_index) || [];
      if (lines.length > 0) {
        const firstLine = Math.min(...lines);
        const lastLine = Math.max(...lines);

        if (firstLine > lastLineExtracted) {
          const rapidDist = Math.hypot(seg.x1 - lastX, seg.y1 - lastY);
          if (rapidDist > 0.001) {
            const rapidDur = rapidDist / RAPID_SPEED_MM_PER_S;
            let assigned = false;
            for (let j = lastLineExtracted + 1; j < firstLine; j++) {
              const lText = ncLines[j] ? ncLines[j].toUpperCase() : "";
              if (lText.includes("G0 ") || lText.includes("G00 ") || lText.trim() === "G0" || lText.trim() === "G00") {
                durations[j] = rapidDur;
                assigned = true;
                break;
              }
            }
            if (!assigned) {
              const j = Math.max(0, firstLine - 1);
              if (j < durations.length) durations[j] += rapidDur;
            }
          }
        }
        lastLineExtracted = lastLine;
        lastX = seg.x2;
        lastY = seg.y2;
      }
    }

    return durations;
  }, [ncLines, segments, lineToSegmentMap]);

  // ── Prefix-sum cumulative time table ────────────────────────────────────────
  const cumulativeTime = useMemo(() => {
    const maxLines = ncLines.length;
    const cum = new Float64Array(maxLines + 1);
    for (let i = 0; i < maxLines; i++) {
      cum[i + 1] = cum[i] + lineDurations[i];
    }
    return cum;
  }, [lineDurations, ncLines.length]);

  const totalDuration = cumulativeTime[ncLines.length]; // seconds at speed=1

  // ── Animation loop refs ──────────────────────────────────────────────────────
  const requestRef = useRef<number>();
  const simTimeRef = useRef<number>(0);   // elapsed simulation seconds at speed=1
  const wallClockRef = useRef<number>(0);   // last rAF timestamp in ms

  // Binary search: find which line corresponds to simTime
  const simTimeToLine = useCallback((t: number): number => {
    const maxLines = ncLines.length;
    if (t <= 0) return 0;
    if (t >= totalDuration) return maxLines - 1;
    let lo = 0, hi = maxLines - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumulativeTime[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }, [cumulativeTime, totalDuration, ncLines.length]);

  const animate = useCallback((timestamp: number) => {
    // First frame of this play session — initialise wall clock
    if (wallClockRef.current === 0) {
      wallClockRef.current = timestamp;
      requestRef.current = requestAnimationFrame(animate);
      return;
    }

    const wallElapsedMs = timestamp - wallClockRef.current;
    wallClockRef.current = timestamp;

    const currentLineIdx = simTimeToLine(simTimeRef.current);
    const isRapid = lineToSegmentMap[currentLineIdx] === undefined;
    const currentSpeedMult = isRapid ? rapidPlaybackSpeed : playbackSpeed;

    simTimeRef.current += (wallElapsedMs / 1000) * currentSpeedMult;
    const maxLines = ncLines.length;

    if (simTimeRef.current >= totalDuration) {
      simTimeRef.current = totalDuration;
      setCurrentSimTime(simTimeRef.current);
      setCurrentLineIndex(maxLines - 1);
      setIsPlaying(false);
      return;
    }

    setCurrentSimTime(simTimeRef.current);
    setCurrentLineIndex(simTimeToLine(simTimeRef.current));
    requestRef.current = requestAnimationFrame(animate);
  }, [playbackSpeed, rapidPlaybackSpeed, totalDuration, ncLines.length, lineToSegmentMap, simTimeToLine]);

  useEffect(() => {
    if (isPlaying) {
      wallClockRef.current = 0; // will be set on first rAF frame
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, animate]);

  // ── Seek: jump to a specific line and sync simulation time ──────────────────
  const seekToLine = useCallback((line: number) => {
    const maxLines = ncLines.length;
    const clamped = Math.max(0, Math.min(maxLines - 1, line));
    simTimeRef.current = cumulativeTime[clamped];
    setCurrentSimTime(cumulativeTime[clamped]);
    wallClockRef.current = 0; // reset wall clock so next rAF frame doesn't skip
    setCurrentLineIndex(clamped);
    setSeekTrigger(t => t + 1);
  }, [cumulativeTime, ncLines.length]);

  const resetPlayback = useCallback(() => {
    simTimeRef.current = 0;
    setCurrentSimTime(0);
    setCurrentLineIndex(0);
    setIsPlaying(false);
    wallClockRef.current = 0;
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = undefined;
    }
  }, []);

  return {
    isPlaying,
    setIsPlaying,
    currentLineIndex,
    setCurrentLineIndex,
    currentSimTime,
    seekToLine,
    seekTrigger,
    playbackSpeed,
    setPlaybackSpeed,
    rapidPlaybackSpeed,
    setRapidPlaybackSpeed,
    totalDuration,
    activeLayers,
    setActiveLayers,
    resetPlayback,
    // Expose the cut speed so GeometryViewer can compute dot animation durations
    // using the same constant without importing it separately.
    CUT_SPEED_MM_PER_S,
    RAPID_SPEED_MM_PER_S,
  };
}