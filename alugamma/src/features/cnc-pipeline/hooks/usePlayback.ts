import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Segment } from "../types";

// ─── Physics constants ────────────────────────────────────────────────────────
const CUT_SPEED_MM_PER_S = 5500 / 60;   // 91.667 mm/s  — G1 feed rate
const RAPID_SPEED_MM_PER_S = 18000 / 60;  // 300 mm/s     — G0 rapid traverse
const DWELL_DURATION_S = 0.04;         // non-geometry lines (headers, M-codes, tool changes)

export function usePlayback(
  maxLines: number,
  segments: Segment[],
  lineToSegmentMap: Record<number, number>,
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [activeLayers, setActiveLayers] = useState<string[]>([]);

  // ── Build per-line duration table (seconds at speed=1) ──────────────────────
  const lineDurations = useMemo(() => {
    const segBySeq = new Map(segments.map((s) => [s.seq_index, s]));
    const durations = new Float64Array(maxLines);

    for (let i = 0; i < maxLines; i++) {
      const seqIdx = lineToSegmentMap[i];
      if (seqIdx === undefined) {
        durations[i] = DWELL_DURATION_S;
        continue;
      }
      const seg = segBySeq.get(seqIdx);
      if (!seg) {
        durations[i] = DWELL_DURATION_S;
        continue;
      }
      const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      // All mapped segments are feed (G1) moves
      durations[i] = len > 0 ? len / CUT_SPEED_MM_PER_S : DWELL_DURATION_S;
    }
    return durations;
  }, [maxLines, segments, lineToSegmentMap]);

  // ── Prefix-sum cumulative time table ────────────────────────────────────────
  const cumulativeTime = useMemo(() => {
    const cum = new Float64Array(maxLines + 1);
    for (let i = 0; i < maxLines; i++) {
      cum[i + 1] = cum[i] + lineDurations[i];
    }
    return cum;
  }, [lineDurations, maxLines]);

  const totalDuration = cumulativeTime[maxLines]; // seconds at speed=1

  // ── Animation loop refs ──────────────────────────────────────────────────────
  const requestRef = useRef<number>();
  const simTimeRef = useRef<number>(0);   // elapsed simulation seconds at speed=1
  const wallClockRef = useRef<number>(0);   // last rAF timestamp in ms

  // Binary search: find which line corresponds to simTime
  const simTimeToLine = useCallback((t: number): number => {
    if (t <= 0) return 0;
    if (t >= totalDuration) return maxLines - 1;
    let lo = 0, hi = maxLines - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumulativeTime[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }, [cumulativeTime, totalDuration, maxLines]);

  const animate = useCallback((timestamp: number) => {
    // First frame of this play session — initialise wall clock
    if (wallClockRef.current === 0) {
      wallClockRef.current = timestamp;
      requestRef.current = requestAnimationFrame(animate);
      return;
    }

    const wallElapsedMs = timestamp - wallClockRef.current;
    wallClockRef.current = timestamp;

    simTimeRef.current += (wallElapsedMs / 1000) * playbackSpeed;

    if (simTimeRef.current >= totalDuration) {
      simTimeRef.current = totalDuration;
      setCurrentLineIndex(maxLines - 1);
      setIsPlaying(false);
      return;
    }

    setCurrentLineIndex(simTimeToLine(simTimeRef.current));
    requestRef.current = requestAnimationFrame(animate);
  }, [playbackSpeed, totalDuration, maxLines, simTimeToLine]);

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
    const clamped = Math.max(0, Math.min(maxLines - 1, line));
    simTimeRef.current = cumulativeTime[clamped];
    wallClockRef.current = 0; // reset wall clock so next rAF frame doesn't skip
    setCurrentLineIndex(clamped);
  }, [cumulativeTime, maxLines]);

  return {
    isPlaying,
    setIsPlaying,
    currentLineIndex,
    setCurrentLineIndex,
    seekToLine,
    playbackSpeed,
    setPlaybackSpeed,
    totalDuration,
    activeLayers,
    setActiveLayers,
    // Expose the cut speed so GeometryViewer can compute dot animation durations
    // using the same constant without importing it separately.
    CUT_SPEED_MM_PER_S,
    RAPID_SPEED_MM_PER_S,
  };
}