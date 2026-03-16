import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch";
import { Square, Maximize } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSheetMetal } from "@/features/sheet-metal/context";
import type { GeometryResult, LineShape } from "@/features/sheet-metal/types";

function getLineLength(shape: LineShape) {
  return Math.round(Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1));
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const pProjX = x1 + t * (x2 - x1);
  const pProjY = y1 + t * (y2 - y1);
  return Math.hypot(px - pProjX, py - pProjY);
}

const PADDING = 80;

type PreviewCanvasProps = {
  geometry: GeometryResult;
};

function CanvasControls() {
  const { centerView } = useControls();

  return (
    <div className="absolute right-4 top-4 z-10">
      <Button
        variant="outline"
        size="icon"
        onClick={() => centerView()}
        className="h-8 w-8 border-white/10 bg-black/40 text-slate-400 hover:bg-white/10 hover:text-white"
        title="Center View"
      >
        <Square className="h-4 w-4" />
      </Button>
    </div>
  );
}

export const PreviewCanvas = forwardRef<{ centerView: () => void }, PreviewCanvasProps>(({ geometry }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<any>(null);
  const [hoveredLine, setHoveredLine] = useState<LineShape | null>(null);

  useImperativeHandle(ref, () => ({
    centerView: () => transformRef.current?.centerView(),
  }));
  const { model } = useSheetMetal();

  // Exact 1:1 pixel size for the drawing
  const canvasWidth = geometry.totalWidth > 0 ? geometry.totalWidth + PADDING * 2 : 1200;
  const canvasHeight = geometry.totalHeight > 0 ? geometry.totalHeight + PADDING * 2 : 760;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // We remove the hardcoded background grid and background color per user instructions
    // The background is handled by the parent container now.

    if (geometry.totalWidth <= 0 || geometry.totalHeight <= 0) return;

    // 1:1 scale mapping without distortion
    const translateX = (value: number) => PADDING + value;
    const translateY = (value: number) => canvasHeight - PADDING - value;

    // Draw Base Rect
    context.save();
    context.fillStyle = "rgba(218, 70, 239, 0.08)";
    context.fillRect(
      translateX(geometry.baseRect.x0),
      translateY(geometry.baseRect.y1),
      (geometry.baseRect.x1 - geometry.baseRect.x0),
      (geometry.baseRect.y1 - geometry.baseRect.y0),
    );
    context.restore();

    const ordered = [...geometry.shapes].sort((left, right) => {
      if (left === hoveredLine) return 1;
      if (right === hoveredLine) return -1;
      return left.layer === right.layer ? 0 : left.layer === "CUT" ? 1 : -1;
    });

    for (const shape of ordered) {
      const isHovered = shape === hoveredLine;
      context.beginPath();
      context.moveTo(translateX(shape.x1), translateY(shape.y1));
      context.lineTo(translateX(shape.x2), translateY(shape.y2));
      
      if (isHovered) {
        context.strokeStyle = "#ffffff";
        context.lineWidth = 4.5;
      } else {
        context.strokeStyle = shape.layer === "CUT" ? "#4ef08b" : "#dd4af5";
        context.lineWidth = shape.layer === "CUT" ? 2.4 : 1.45;
      }
      
      context.stroke();
    }
  }, [geometry, hoveredLine, canvasWidth, canvasHeight]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    
    // Get mouse position relative to viewport
    if (tooltipRef.current) {
      const viewerRect = tooltipRef.current.parentElement?.getBoundingClientRect();
      if (viewerRect) {
        const cssX = e.clientX - viewerRect.left;
        const cssY = e.clientY - viewerRect.top;
        tooltipRef.current.style.left = `${cssX + 16}px`;
        tooltipRef.current.style.top = `${cssY + 16}px`;
      }
    }

    if (geometry.totalWidth <= 0 || geometry.totalHeight <= 0) return;

    // Scale physical screen pixels back to 1:1 internal canvas pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    const translateX = (val: number) => PADDING + val;
    const translateY = (val: number) => canvasHeight - PADDING - val;

    let closest: LineShape | null = null;
    let minDist = 18 * scaleX; // hover collision distance threshold adjusted by scale

    for (const shape of geometry.shapes) {
      const x1 = translateX(shape.x1);
      const y1 = translateY(shape.y1);
      const x2 = translateX(shape.x2);
      const y2 = translateY(shape.y2);
      const dist = distanceToSegment(canvasX, canvasY, x1, y1, x2, y2);
      if (dist < minDist) {
        minDist = dist;
        closest = shape;
      }
    }

    if (closest !== hoveredLine) {
      setHoveredLine(closest);
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#080c14]">
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.1}
        maxScale={8}
        centerOnInit
        limitToBounds={model.rubberband}
        wheel={{ step: 0.1 }}
      >
        <CanvasControls />
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredLine(null)}
            className="outline-none"
            style={{ display: "block" }}
          />
        </TransformComponent>
      </TransformWrapper>
      
      <div 
         ref={tooltipRef} 
         className={`pointer-events-none absolute z-50 rounded-lg bg-emerald-950/90 shadow-[0_0_15px_rgba(20,180,100,0.2)] border border-emerald-500/30 backdrop-blur-md px-3 py-1.5 text-xs font-mono font-bold text-emerald-300 transition-opacity duration-200 ${hoveredLine ? 'opacity-100' : 'opacity-0'}`}
      >
        {hoveredLine ? `${getLineLength(hoveredLine)} mm` : ""}
      </div>
    </div>
  );
});
