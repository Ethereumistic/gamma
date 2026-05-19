// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Preview Canvas
// HTML5 Canvas renderer for sheet layouts with pan/zoom.
// Draws all part layers (0, FREZ, FREZ_135, HOLES, CUT, SHEETS).
// ────────────────────────────────────────────────────────────────────────────────

import {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";

import makerjs from "makerjs";
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
import type { SheetLayout, NestPart } from "./types";
import { collectAndDeduplicate } from "./deduplicator";
import { extractDxfModel } from "./dxf-reader";

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

    // Pre-extract Maker.js models for every unique part
    const partModelMap = useMemo(() => {
      const map = new Map<string, makerjs.IModel | null>();
      for (const part of parts) {
        let model = part.dxfContent ? extractDxfModel(part.dxfContent) : null;
        // Fallback: simple Layer-0 rectangle from l0Bbox
        if (!model && part.l0Bbox) {
          const { x0, y0, x1, y1 } = part.l0Bbox;
          const fb: makerjs.IModel = { paths: {} };
          const l1 = new makerjs.paths.Line([x0, y0], [x1, y0]) as makerjs.IPath;
          l1.layer = LAYER_ZERO;
          const l2 = new makerjs.paths.Line([x1, y0], [x1, y1]) as makerjs.IPath;
          l2.layer = LAYER_ZERO;
          const l3 = new makerjs.paths.Line([x1, y1], [x0, y1]) as makerjs.IPath;
          l3.layer = LAYER_ZERO;
          const l4 = new makerjs.paths.Line([x0, y1], [x0, y0]) as makerjs.IPath;
          l4.layer = LAYER_ZERO;
          fb.paths = { l1, l2, l3, l4 };
          model = fb;
        }
        map.set(part.id, model);
      }
      return map;
    }, [parts]);

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
        ctx.fillText(
          "Add parts and run packing",
          sx(SHEET_WIDTH / 2),
          sy(SHEET_HEIGHT / 2),
        );
        return;
      }

      const partMap = new Map(parts.map((p) => [p.id, p]));

      // ── Draw margin guide (Mode A) ──
      if (layout.mode === "A") {
        const m = MARGIN;
        ctx.strokeStyle = CANVAS_COLORS.marginFill;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
          sx(m),
          sy(m),
          (SHEET_WIDTH - 2 * m) * scale,
          (SHEET_HEIGHT - 2 * m) * scale,
        );
        ctx.setLineDash([]);
      } else {
        // Mode B: draw alignment guide (centered or bottom-left)
        const guideX1 = layout.offsetX;
        const guideY1 = layout.offsetY;
        const maxX = Math.max(
          ...layout.placements.map((p) => p.packX + p.packWidth),
        );
        const maxY = Math.max(
          ...layout.placements.map((p) => p.packY + p.packHeight),
        );
        const guideX2 = layout.offsetX + maxX;
        const guideY2 = layout.offsetY + maxY;
        ctx.strokeStyle = CANVAS_COLORS.marginFill;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
          sx(guideX1),
          sy(guideY1),
          (guideX2 - guideX1) * scale,
          (guideY2 - guideY1) * scale,
        );
        ctx.setLineDash([]);
      }

      // ── Draw placed parts (DXF geometry: 0, FREZ, FREZ_135, HOLES) ──
      for (const placement of layout.placements) {
        const part = partMap.get(placement.partId);
        if (!part) continue;

        const baseModel = partModelMap.get(part.id);
        if (baseModel) {
          // Deep-clone so rotation/movement don't mutate the cached base model
          const instance: makerjs.IModel = JSON.parse(JSON.stringify(baseModel));

          // 1. Normalise raw DXF coordinates so the part's l0 lower-left sits at (0,0)
          makerjs.model.moveRelative(instance, [
            -part.l0Bbox.x0,
            -part.l0Bbox.y0,
          ]);

          // 2. Rotate and align
          if (placement.rotation === 90) {
            // Rotate 90° CCW around origin, then shift so rotated CUT bbox aligns with (0,0).
            // After CCW rotation, the bbox shifts left by l0Height.
            // Adding (l0Height + CUT_OFFSET) in X and CUT_OFFSET in Y brings
            // the CUT bbox lower-left back to (0,0), matching the 0° case.
            makerjs.model.rotate(instance, 90, [0, 0]);
            makerjs.model.moveRelative(instance, [part.l0Height + CUT_OFFSET, CUT_OFFSET]);
          } else {
            // No rotation — shift so CUT bbox is at (0,0)
            makerjs.model.moveRelative(instance, [CUT_OFFSET, CUT_OFFSET]);
          }

          // 3. Translate to final sheet position (pack position + layout offset)
          makerjs.model.moveRelative(instance, [placement.packX + layout.offsetX, placement.packY + layout.offsetY]);

          // Walk all paths (including nested sub-models) and draw them
          makerjs.model.walk(instance, {
            onPath: (walked) => {
              const path = walked.pathContext;
              const offset = walked.offset;
              const layer = walked.layer;
              const color = CANVAS_COLORS[layer] ?? "#ffffff";
              ctx.strokeStyle = color;
              ctx.lineWidth = layer === LAYER_CUT ? 1.5 : 1;

              switch (path.type) {
                case "line": {
                  const line = path as makerjs.IPathLine;
                  ctx.beginPath();
                  ctx.moveTo(
                    sx(line.origin[0] + offset[0]),
                    sy(line.origin[1] + offset[1]),
                  );
                  ctx.lineTo(
                    sx(line.end[0] + offset[0]),
                    sy(line.end[1] + offset[1]),
                  );
                  ctx.stroke();
                  break;
                }
                case "arc": {
                  const arc = path as makerjs.IPathArc;
                  const cx = arc.origin[0] + offset[0];
                  const cy = arc.origin[1] + offset[1];
                  const r = arc.radius * scale;
                  const startRad = (arc.startAngle * Math.PI) / 180;
                  const endRad = (arc.endAngle * Math.PI) / 180;
                  ctx.beginPath();
                  // In canvas (Y-down), angles increase clockwise.
                  // Maker.js angles increase CCW.  Since we don't flip Y,
                  // mapping the angles directly with anticlockwise=false
                  // sweeps in the CW screen direction, matching the mirrored geometry.
                  ctx.arc(sx(cx), sy(cy), r, startRad, endRad, false);
                  ctx.stroke();
                  break;
                }
                case "circle": {
                  const circle = path as makerjs.IPathCircle;
                  const cx = circle.origin[0] + offset[0];
                  const cy = circle.origin[1] + offset[1];
                  const r = circle.radius * scale;
                  ctx.beginPath();
                  ctx.arc(sx(cx), sy(cy), r, 0, 2 * Math.PI);
                  ctx.stroke();
                  break;
                }
              }
            },
          });
        }

        // CUT boundary guide (packing box)
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

        // Part label (centered on Layer 0 bbox)
        // For 90° rotation, l0Width and l0Height swap in sheet space,
        // and the L0 bbox is offset by l0Height in X (alignment shift).
        const l0ShiftX = placement.rotation === 90 ? part.l0Height : 0;
        const labelW = placement.rotation === 90 ? part.l0Height : part.l0Width;
        const labelH = placement.rotation === 90 ? part.l0Width : part.l0Height;
        const labelX =
          placement.packX + layout.offsetX + CUT_OFFSET + l0ShiftX + labelW / 2;
        const labelY =
          placement.packY + layout.offsetY + CUT_OFFSET + labelH / 2;
        ctx.fillStyle = CANVAS_COLORS.label;
        ctx.font = `${Math.max(8, 10 * scale)}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(part.name, sx(labelX), sy(labelY));
      }

      // ── Draw deduplicated CUT lines ──
      const dedupedCut =
        layout.dedupedCutSegments.length > 0
          ? layout.dedupedCutSegments
          : collectAndDeduplicate(
              layout.placements,
              parts,
              layout.mode,
              layout.offsetX,
              layout.offsetY,
            );

      for (const seg of dedupedCut) {
        ctx.beginPath();
        ctx.moveTo(sx(seg.x1), sy(seg.y1));
        ctx.lineTo(sx(seg.x2), sy(seg.y2));
        ctx.strokeStyle = CANVAS_COLORS[LAYER_CUT] ?? "#ef4444";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── Draw sheet label ──
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
        `Mode ${layout.mode} (${layout.alignment}) | ${layout.placements.length} parts | ×${layout.repeatCount}`,
        sx(10),
        sy(SHEET_HEIGHT + 60),
      );
    }, [layout, parts, getTransform, partModelMap]);

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

    // ── Wheel Handler (non-passive to allow preventDefault) ───────────────────
    // React's onWheel is passive by default, so e.preventDefault() is silently
    // ignored. We must attach a non-passive listener directly on the canvas
    // element to prevent the browser from scrolling the page on wheel events.

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        zoomRef.current = Math.max(0.2, Math.min(5, zoomRef.current * delta));
        draw();
      };

      canvas.addEventListener("wheel", onWheel, { passive: false });
      return () => canvas.removeEventListener("wheel", onWheel);
    }, [draw]);

    // ── Mouse Handlers ──────────────────────────────────────────────────────

null

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      isDraggingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }, []);

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        panRef.current.x += dx;
        panRef.current.y += dy;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        draw();
      },
      [draw],
    );

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
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    );
  },
);
