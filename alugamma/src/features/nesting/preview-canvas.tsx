// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Preview Canvas
// HTML5 Canvas renderer for sheet layouts with pan/zoom.
// Draws all part layers (0, FREZ, FREZ_135, HOLES, CUT, SHEETS).
// Y-coordinate is flipped to match DXF output (Y-up in DXF, Y-down on canvas).
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
  LAYER_CUT,
  LAYER_SHEETS,
  getCanvasColor,
} from "./constants";
import type { SheetLayout, NestPart } from "./types";
import { formatSheetTitle } from "./types";
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
          l1.layer = "0";
          const l2 = new makerjs.paths.Line([x1, y0], [x1, y1]) as makerjs.IPath;
          l2.layer = "0";
          const l3 = new makerjs.paths.Line([x1, y1], [x0, y1]) as makerjs.IPath;
          l3.layer = "0";
          const l4 = new makerjs.paths.Line([x0, y1], [x0, y0]) as makerjs.IPath;
          l4.layer = "0";
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
      // Extra vertical space for labels above and below the sheet
      const padding = 40;
      const scaleX = (canvas.width - 2 * padding) / SHEET_WIDTH;
      const scaleY = (canvas.height - 2 * padding) / (SHEET_HEIGHT + 200);
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

      // Helper to convert DXF (Y-up) coordinates to canvas (Y-down) coordinates.
      // DXF origin (0,0) is bottom-left; canvas origin is top-left.
      // We flip Y so that DXF y=0 maps to the bottom of the canvas sheet area.
      const sx = (x: number) => offsetX + x * scale;
      const sy = (y: number) => offsetY + (SHEET_HEIGHT - y) * scale;

      // Helper to draw a filled/stroked rect in DXF coordinates.
      // (x, y) = bottom-left corner in DXF space; w, h = dimensions.
      const fillDxfRect = (x: number, y: number, w: number, h: number, fillColor: string) => {
        ctx.fillStyle = fillColor;
        ctx.fillRect(sx(x), sy(y + h), w * scale, h * scale);
      };
      const strokeDxfRect = (
        x: number, y: number, w: number, h: number,
        strokeColor: string, lineWidth: number = 1,
      ) => {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(sx(x), sy(y + h), w * scale, h * scale);
      };

      // ── Draw sheet background ──
      fillDxfRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT, CANVAS_COLORS.sheetFill);

      // ── Draw sheet border ──
      strokeDxfRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT, CANVAS_COLORS[LAYER_SHEETS] ?? "rgb(39,118,187)", 2);

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
        strokeDxfRect(m, m, SHEET_WIDTH - 2 * m, SHEET_HEIGHT - 2 * m, CANVAS_COLORS.marginFill, 1);
        ctx.setLineDash([]);
      } else {
        // Mode B: draw alignment guide (centered or bottom-left)
        const guideX = layout.offsetX;
        const guideY = layout.offsetY;
        const maxX = Math.max(
          ...layout.placements.map((p) => p.packX + p.packWidth),
        );
        const maxY = Math.max(
          ...layout.placements.map((p) => p.packY + p.packHeight),
        );
        const guideW = maxX;
        const guideH = maxY;
        ctx.strokeStyle = CANVAS_COLORS.marginFill;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        strokeDxfRect(guideX, guideY, guideW, guideH, CANVAS_COLORS.marginFill, 1);
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
              const color = getCanvasColor(layer);
              ctx.strokeStyle = color;
              ctx.lineWidth = layer === LAYER_CUT ? 1.5 : 1;

              switch (path.type) {
                case "line": {
                  const line = path as makerjs.IPathLine;
                  drawLine(
                    ctx,
                    sx(line.origin[0] + offset[0]),
                    sy(line.origin[1] + offset[1]),
                    sx(line.end[0] + offset[0]),
                    sy(line.end[1] + offset[1]),
                    color,
                    layer === LAYER_CUT ? 1.5 : 1,
                  );
                  break;
                }
                case "arc": {
                  const arc = path as makerjs.IPathArc;
                  const cx = arc.origin[0] + offset[0];
                  const cy = arc.origin[1] + offset[1];
                  const r = arc.radius * scale;
                  // Flip arc angles for Y-flip: negate angles and use anticlockwise
                  const startRad = -(arc.startAngle * Math.PI) / 180;
                  const endRad = -(arc.endAngle * Math.PI) / 180;
                  ctx.beginPath();
                  ctx.arc(sx(cx), sy(cy), r, startRad, endRad, true);
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
        const cutColor = getCanvasColor(LAYER_CUT);
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        strokeDxfRect(
          placement.packX + layout.offsetX,
          placement.packY + layout.offsetY,
          placement.packWidth,
          placement.packHeight,
          cutColor,
          0.5,
        );
        ctx.setLineDash([]);

        // Part label (centered on Layer 0 bbox in DXF coordinates)
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
        ctx.textBaseline = "middle";
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

      const cutColor = getCanvasColor(LAYER_CUT);
      for (const seg of dedupedCut) {
        drawLine(
          ctx,
          sx(seg.x1), sy(seg.y1),
          sx(seg.x2), sy(seg.y2),
          cutColor,
          1.5,
        );
      }

      // ── Draw sheet label (top-left above the sheet) ──
      // Format: {number}_r{repeat}_{mode}_p{parts}_u{utilization}%
      const titleText = formatSheetTitle(layout);
      ctx.fillStyle = CANVAS_COLORS.label;
      ctx.font = `bold ${Math.max(12, 14 * scale)}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(
        titleText,
        sx(10),
        sy(SHEET_HEIGHT + 40),
      );

      // ── Draw mode indicator (left, below title) ──
      ctx.fillStyle = "#6b7280";
      ctx.font = `${Math.max(8, 10 * scale)}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(
        `Mode ${layout.mode} (${layout.alignment}) | ${layout.placements.length} parts | ×${layout.repeatCount}`,
        sx(10),
        sy(SHEET_HEIGHT + 60),
      );

      // ── Draw repetition count (bottom-right, below the sheet) ──
      const repeatText = String(layout.repeatCount);
      ctx.fillStyle = CANVAS_COLORS.label;
      ctx.font = `bold ${Math.max(10, 14 * scale)}px sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(
        repeatText,
        sx(SHEET_WIDTH - 10),
        sy(-30),
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