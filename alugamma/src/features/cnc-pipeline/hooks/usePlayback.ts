import { useState, useEffect, useRef, useCallback } from "react";

export function usePlayback(maxLines: number, estimatedTime: number) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); 
  const [activeLayers, setActiveLayers] = useState<string[]>([]);

  const requestRef = useRef<number>();
  const lastUpdateRef = useRef<number>(0);

  const animate = useCallback((time: number) => {
    if (!lastUpdateRef.current) {
      lastUpdateRef.current = time;
    }

    const progress = time - lastUpdateRef.current;
    
    // speed 1 = completes in estimatedTime seconds
    // lines per ms = maxLines / (estimatedTime * 1000)
    const baseLinesPerMs = maxLines / Math.max(0.1, estimatedTime * 1000);
    const linesPerMs = baseLinesPerMs * playbackSpeed;
    const linesToAdvance = progress * linesPerMs;

    if (linesToAdvance >= 1) {
      setCurrentLineIndex((prev) => {
        const next = prev + Math.floor(linesToAdvance);
        if (next >= maxLines - 1) {
          setIsPlaying(false);
          return maxLines - 1;
        }
        return next;
      });
      lastUpdateRef.current = time;
    }

    requestRef.current = requestAnimationFrame(animate);
  }, [maxLines, estimatedTime, playbackSpeed]);

  useEffect(() => {
    if (isPlaying) {
      lastUpdateRef.current = 0;
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, animate]);

  return {
    isPlaying,
    setIsPlaying,
    currentLineIndex,
    setCurrentLineIndex,
    playbackSpeed,
    setPlaybackSpeed,
    activeLayers,
    setActiveLayers,
  };
}
