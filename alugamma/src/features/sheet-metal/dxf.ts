import makerjs from "makerjs";
import type { GeometryResult, SheetMetalModel, LineShape, SideKey } from "@/features/sheet-metal/types";

function getArrowPaths(direction: SideKey, cx: number, cy: number, length: number = 40): makerjs.IPath[] {
  const half = length / 2;
  const head = 12;
  const paths: makerjs.IPath[] = [];

  if (direction === "top") {
    paths.push(new makerjs.paths.Line([cx, cy - half], [cx, cy + half])); // shaft
    paths.push(new makerjs.paths.Line([cx - head / 2, cy + half - head], [cx, cy + half])); // left
    paths.push(new makerjs.paths.Line([cx + head / 2, cy + half - head], [cx, cy + half])); // right
  } else if (direction === "bottom") {
    paths.push(new makerjs.paths.Line([cx, cy + half], [cx, cy - half]));
    paths.push(new makerjs.paths.Line([cx - head / 2, cy - half + head], [cx, cy - half]));
    paths.push(new makerjs.paths.Line([cx + head / 2, cy - half + head], [cx, cy - half]));
  } else if (direction === "right") {
    paths.push(new makerjs.paths.Line([cx - half, cy], [cx + half, cy]));
    paths.push(new makerjs.paths.Line([cx + half - head, cy - head / 2], [cx + half, cy]));
    paths.push(new makerjs.paths.Line([cx + half - head, cy + head / 2], [cx + half, cy]));
  } else if (direction === "left") {
    paths.push(new makerjs.paths.Line([cx + half, cy], [cx - half, cy]));
    paths.push(new makerjs.paths.Line([cx - half + head, cy - head / 2], [cx - half, cy]));
    paths.push(new makerjs.paths.Line([cx - half + head, cy + head / 2], [cx - half, cy]));
  }
  return paths;
}

export function buildDxf(geometry: GeometryResult, designName: string, modelConfig: SheetMetalModel) {
  const model: makerjs.IModel = {
    paths: {},
  };

  geometry.shapes.forEach((shape, i) => {
    // Preserve the native web Y coordinates. Web canvas already computes Y upwards in Cartesian space!
    const line = new makerjs.paths.Line([shape.x1, shape.y1], [shape.x2, shape.y2]) as makerjs.IPath;
    line.layer = shape.layer;
    model.paths![`shape_${i}`] = line;
  });

  const cx = (geometry.baseRect.x0 + geometry.baseRect.x1) / 2;
  const cy = (geometry.baseRect.y0 + geometry.baseRect.y1) / 2;

  const textHeight = 64;
  const estimatedWidth = designName.length * textHeight * 0.7;

  if (modelConfig.includeArrow) {
    // Arrow centered horizontally, positioned above the name label
    const arrowLength = 50;
    const arrowGap = 15; // gap between text top and arrow center
    const arrowCx = cx;
    const arrowCy = (cy - textHeight / 2) + textHeight + arrowGap + arrowLength / 2;

    const arrowLines = getArrowPaths(modelConfig.arrowDirection, arrowCx, arrowCy, arrowLength);
    arrowLines.forEach((line, i) => {
      line.layer = "0";
      model.paths![`arrow_${i}`] = line;
    });
  }

  let dxfString = makerjs.exporter.toDXF(model, {
    units: makerjs.unitType.Millimeter,
    layerOptions: {
      "0": { color: 7 }, // white / black
      CUT: { color: 3 }, // green
      FREZ: { color: 6 }, // magenta
      HOLES: { color: 2 }, // yellow
    },
  });

  if (modelConfig.includeName && designName.trim()) {
    // Name centered horizontally on the part (no offset regardless of arrow)
    const textX = cx - estimatedWidth / 2;
    // Vertical centering: roughly centered on the part
    const textY = cy - textHeight / 2;

    const textDxf = `0\nTEXT\n8\n0\n10\n${textX}\n20\n${textY}\n40\n${textHeight}\n1\n${designName.trim()}\n`;

    // Inject TEXT entity right before the ENDSEC of the ENTITIES section
    const entitiesSectionIdx = dxfString.indexOf("ENTITIES");
    if (entitiesSectionIdx !== -1) {
      const lineEnding = dxfString.includes("\r\n") ? "\r\n" : "\n";
      const endsecMatch = dxfString.indexOf(`0${lineEnding}ENDSEC`, entitiesSectionIdx);

      if (endsecMatch !== -1) {
        const formattedTextDxf = textDxf.replace(/\n/g, lineEnding);
        dxfString = dxfString.slice(0, endsecMatch) + formattedTextDxf + dxfString.slice(endsecMatch);
      }
    }
  }

  return dxfString;
}

