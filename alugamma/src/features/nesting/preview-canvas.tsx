// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Preview Canvas
// HTML5 Canvas renderer for sheet layouts with pan/zoom
// ────────────────────────────────────────────────────────────────────────────────

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

import {
  SHEET_WIDTH,
  SHEET_HEIGHT,
  MARGIN,
  CUT_OFFSET,
  CANVAS_COLORS,
  LAYER_SHEETS,
  LAYER_ZERO,
  LAYER_CUT,
} from "./constants";
import type { SheetLayout, NestPart, Placement, Segment } from "./types";
import { collectAndDeduplicate } from "./deduplicator";

// ── Canvas Ref API ─────────────────────────────────────────────────────────

export type PreviewCanvasHandle = {
  centerView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

// ── Drawing Helpers ────────────────────────────────────────────────────────

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number = 1,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  strokeColor: string,
  fillColor?: string,
  lineWidth: number = 1,
) {
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, w, h);
}

// ── Component Props ────────────────────────────────────────────────────────

type PreviewCanvasProps = {
  layout: SheetLayout | null;
  parts: NestPart[];
  className?: string;
};

// ── Component ──────────────────────────────────────────────────────────────

export const PreviewCanvas = forwardRef<PreviewCanvasHandle, PreviewCanvasProps>(
  function PreviewCanvas({ layout, parts, className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const panRef = useRef({ x: 0, y: 0 });
    const zoomRef = useRef(1);
    const isDraggingRef = useRef(false);
    const lastMouseRef = useRef({ x: 0, y: 0 });

    // ── Transform ────────────────────────────────────────────────────────────

    const getTransform = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return { scale: 1, offsetX: 0, offsetY: 0 };

      // Fit the sheet in the canvas with some padding
      const padding = 40;
      const scaleX = (canvas.width - 2 * padding) / SHEET_WIDTH;
      const scaleY = (canvas.height - 2 * padding) / (SHEET_HEIGHT + 150);
      const baseScale = Math.min(scaleX, scaleY);

      const scale = baseScale * zoomRef.current;
      const offsetX = padding + panRef.current.x;
      const offsetY = padding + panRef.current.y;

      return { scale, offsetX, offsetY };
    }, []);

    // ── Draw ────────────────────────────────────────────────────────────────

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { scale, offsetX, offsetY } = getTransform();

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#080c14";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Helper to convert sheet coords to canvas coords
      const sx = (x: number) => offsetX + x * scale;
      const sy = (y: number) => offsetY + y * scale;

      // ── Draw sheet background ──
      ctx.fillStyle = CANVAS_COLORS.sheetFill;
      ctx.fillRect(sx(0), sy(0), SHEET_WIDTH * scale, SHEET_HEIGHT * scale);

      // ── Draw sheet border ──
      ctx.strokeStyle = CANVAS_COLORS[LAYER_SHEETS] ?? "#9ca3af";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(0), sy(0), SHEET_WIDTH * scale, SHEET_HEIGHT * scale);

      if (!layout || layout.placements.length === 0) {
        // Draw "No layout" text
        ctx.fillStyle = "#6b7280";
        ctx.font = `${14}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("Add parts and run packing", sx(SHEET_WIDTH / 2), sy(SHEET_HEIGHT / 2));
        return;
      }

      const partMap = new Map(parts.map((p) => [p.id, p]));

      // ── Draw margin guide (Mode A) ──
      if (layout.mode === "A") {
        const m = MARGIN;
        ctx.strokeStyle = CANVAS_COLORS.marginFill;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(sx(m), sy(m), (SHEET_WIDTH - 2 * m) * scale, (SHEET_HEIGHT - 2 * m) * scale);
        ctx.setLineDash([]);
      } else {
        // Mode B: draw centering guide
        const guideX1 = layout.offsetX;
        const guideY1 = layout.offsetY;
        const maxX = Math.max(...layout.placements.map((p) => p.packX + p.packWidth));
        const maxY = Math.max(...layout.placements.map((p) => p.packY + p.packHeight));
        const guideX2 = layout.offsetX + maxX;
        const guideY2 = layout.offsetY + maxY;
        ctx.strokeStyle = CANVAS_COLORS.marginFill;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(sx(guideX1), sy(guideY1), (guideX2 - guideX1) * scale, (guideY2 - guideY1) * scale);
        ctx.setLineDash([]);
      }

      // ── Draw placed parts (Layer 0 outlines) ──
      for (const placement of layout.placements) {
        const part = partMap.get(placement.partId);
        if (!part) continue;

        const insertX = placement.packX + layout.offsetX + CUT_OFFSET;
        const insertY = placement.packY + layout.offsetY + CUT_OFFSET;

        // Draw part bounding box (Layer 0)
        ctx.strokeStyle = CANVAS_COLORS[LAYER_ZERO] ?? "#ffffff";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          sx(insertX),
          sy(insertY),
          part.l0Width * scale,
          part.l0Height * scale,
        );

        // Draw CUT boundary (slightly larger, dashed)
        ctx.strokeStyle = CANVAS_COLORS[LAYER_CUT] ?? "#ef4444";
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(
          sx(placement.packX + layout.offsetX),
          sy(placement.packY + layout.offsetY),
          placement.packWidth * scale,
          placement.packHeight * scale,
        );
        ctx.setLineDash([]);

        // Draw part label
        ctx.fillStyle = CANVAS_COLORS.label;
        ctx.font = `${Math.max(8, 10 * scale)}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(
          part.name,
          sx(insertX + part.l0Width / 2),
          sy(insertY + part.l0Height / 2),
        );
      }

      // ── Draw deduplicated CUT lines ──
      const dedupedCut = layout.dedupedCutSegments.length > 0
        ? layout.dedupedCutSegments
        : collectAndDeduplicate(layout.placements, parts, layout.mode, layout.offsetX, layout.offsetY);

      for (const seg of dedupedCut) {
        ctx.beginPath();
        ctx.moveTo(sx(seg.x1), sy(seg.y1));
        ctx.lineTo(sx(seg.x2), sy(seg.y2));
        ctx.strokeStyle = CANVAS_COLORS[LAYER_CUT] ?? "#ef4444";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── Draw label ──
      const labelText = `${layout.sheetName}_x${layout.repeatCount}`;
      ctx.fillStyle = CANVAS_COLORS.label;
      ctx.font = `bold ${Math.max(12, 14 * scale)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(
        labelText,
        sx(SHEET_WIDTH / 2),
        sy(SHEET_HEIGHT + 40),
      );

      // ── Draw mode indicator ──
      ctx.fillStyle = "#6b7280";
      ctx.font = `${Math.max(8, 10 * scale)}px sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(
        `Mode ${layout.mode} | ${layout.placements.length} parts | ×${layout.repeatCount}`,
        sx(10),
        sy(SHEET_HEIGHT + 60),
      );
    }, [layout, parts, getTransform]);

    // ── Canvas resize ───────────────────────────────────────────────────────

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const resizeCanvas = () => {
        const parent = canvas.parentElement;
        if (!parent) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = parent.clientHeight * dpr;
        canvas.style.width = `${parent.clientWidth}px`;
        canvas.style.height = `${parent.clientHeight}px`;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(dpr, dpr);
        draw();
      };

      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);
      return () => window.removeEventListener("resize", resizeCanvas);
    }, [draw]);

    // ── Redraw when layout changes ──────────────────────────────────────────

    useEffect(() => {
      draw();
    }, [layout, parts, draw]);

    // ── Mouse Handlers ──────────────────────────────────────────────────────

    const handleWheel = useCallback((e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoomRef.current = Math.max(0.2, Math.min(5, zoomRef.current * delta));
      draw();
    }, [draw]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      isDraggingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      panRef.current.x += dx;
      panRef.current.y += dy;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      draw();
    }, [draw]);

    const handleMouseUp = useCallback(() => {
      isDraggingRef.current = false;
    }, []);

    // ── Imperative Handle ──────────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
      centerView: () => {
        panRef.current = { x: 0, y: 0 };
        zoomRef.current = 1;
        draw();
      },
      zoomIn: () => {
        zoomRef.current = Math.min(5, zoomRef.current * 1.2);
        draw();
      },
      zoomOut: () => {
        zoomRef.current = Math.max(0.2, zoomRef.current / 1.2);
        draw();
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        className={className ?? "w-full h-full"}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    );
  },
);