import { useState, useEffect, useRef, useCallback } from "react";

export function usePlayback(maxLines: number) {
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
    
    // Adjust logic: increment line index based on speed.
    // Let's say speed 1 = 10 lines per second.
    const linesPerMs = (playbackSpeed * 10) / 1000;
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
  }, [maxLines, playbackSpeed]);

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
