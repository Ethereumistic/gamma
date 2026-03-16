import { useState, useRef, useEffect, useCallback } from "react";

// ─── DXF BUILDER ───────────────────────────────────────────────────────────────
function buildDXF(shapes) {
  const lines = [];
  lines.push(`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n`);
  lines.push(`0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n0\nTABLE\n2\nLAYER\n70\n2\n0\nLAYER\n2\nCUT\n70\n0\n62\n3\n6\nCONTINUOUS\n0\nLAYER\n2\nFREZ\n70\n0\n62\n6\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n`);
  lines.push(`0\nSECTION\n2\nENTITIES\n`);
  for (const s of shapes) {
    if (s.type === "line") {
      lines.push(`0\nLINE\n8\n${s.layer}\n10\n${s.x1.toFixed(4)}\n20\n${s.y1.toFixed(4)}\n30\n0.0\n11\n${s.x2.toFixed(4)}\n21\n${s.y2.toFixed(4)}\n31\n0.0\n`);
    }
  }
  lines.push(`0\nENDSEC\n0\nEOF\n`);
  return lines.join("");
}

// ─── GEOMETRY ENGINE ────────────────────────────────────────────────────────────
function getCumulativeOffsets(flanges) {
  const offsets = [];
  let cum = 0;
  for (const f of flanges) { cum += f.width; offsets.push(cum); }
  return offsets;
}

function addRect(shapes, layer, x0, y0, x1, y1) {
  shapes.push({ type: "line", layer, x1: x0, y1: y0, x2: x1, y2: y0 });
  shapes.push({ type: "line", layer, x1: x1, y1: y0, x2: x1, y2: y1 });
  shapes.push({ type: "line", layer, x1: x1, y1: y1, x2: x0, y2: y1 });
  shapes.push({ type: "line", layer, x1: x0, y1: y1, x2: x0, y2: y0 });
}

function computeCorners({ x0, y0, x1, y1, tw, rw, bw, lw, tAngle, rAngle, bAngle, lAngle }) {
  const toRad = d => d * Math.PI / 180;
  const outerTop = y1 + tw, outerBottom = y0 - bw;
  const outerLeft = x0 - lw, outerRight = x1 + rw;

  function corner(cx, cy, horizDepth, vertDepth, horizAngle, vertAngle, hDir, vDir) {
    const oh = hDir > 0 ? outerTop : outerBottom;
    const ov = vDir > 0 ? outerRight : outerLeft;
    if (horizDepth === 0 && vertDepth === 0) return { h: { x: cx, y: cy }, v: { x: cx, y: cy } };
    if (horizDepth === 0) return { h: { x: cx, y: cy }, v: { x: ov, y: cy } };
    if (vertDepth === 0) return { h: { x: cx, y: oh }, v: { x: cx, y: cy } };
    const offH = vertDepth * Math.tan(toRad(horizAngle));
    const offV = horizDepth * Math.tan(toRad(vertAngle));
    return {
      h: { x: cx - vDir * offH, y: oh },
      v: { x: ov, y: cy - hDir * offV }
    };
  }

  return {
    TL: corner(x0, y1, tw, lw, tAngle, lAngle, +1, -1),
    TR: corner(x1, y1, tw, rw, tAngle, rAngle, +1, +1),
    BR: corner(x1, y0, bw, rw, bAngle, rAngle, -1, +1),
    BL: corner(x0, y0, bw, lw, bAngle, lAngle, -1, -1),
  };
}

function computeShapes({ W, H, sides }) {
  const shapes = [];
  const { top: T, right: R, bottom: B, left: L } = sides;

  const lw = L.flanges.reduce((a, f) => a + f.width, 0);
  const bw = B.flanges.reduce((a, f) => a + f.width, 0);
  const tw = T.flanges.reduce((a, f) => a + f.width, 0);
  const rw = R.flanges.reduce((a, f) => a + f.width, 0);

  const x0 = lw, y0 = bw;
  const x1 = x0 + W, y1 = y0 + H;

  // Inner rectangle → FREZ
  addRect(shapes, "FREZ", x0, y0, x1, y1);

  // Frez lines inward from each inner edge
  for (const fz of T.frezLines) shapes.push({ type: "line", layer: "FREZ", x1: x0, y1: y1 - fz.depth, x2: x1, y2: y1 - fz.depth });
  for (const fz of B.frezLines) shapes.push({ type: "line", layer: "FREZ", x1: x0, y1: y0 + fz.depth, x2: x1, y2: y0 + fz.depth });
  for (const fz of L.frezLines) shapes.push({ type: "line", layer: "FREZ", x1: x0 + fz.depth, y1: y0, x2: x0 + fz.depth, y2: y1 });
  for (const fz of R.frezLines) shapes.push({ type: "line", layer: "FREZ", x1: x1 - fz.depth, y1: y0, x2: x1 - fz.depth, y2: y1 });

  // Flange lines outward (cumulative) → FREZ
  for (const off of getCumulativeOffsets(T.flanges)) shapes.push({ type: "line", layer: "FREZ", x1: x0, y1: y1 + off, x2: x1, y2: y1 + off });
  for (const off of getCumulativeOffsets(B.flanges)) shapes.push({ type: "line", layer: "FREZ", x1: x0, y1: y0 - off, x2: x1, y2: y0 - off });
  for (const off of getCumulativeOffsets(L.flanges)) shapes.push({ type: "line", layer: "FREZ", x1: x0 - off, y1: y0, x2: x0 - off, y2: y1 });
  for (const off of getCumulativeOffsets(R.flanges)) shapes.push({ type: "line", layer: "FREZ", x1: x1 + off, y1: y0, x2: x1 + off, y2: y1 });

  // CUT outline (single closed polygon with mitre corners)
  const c = computeCorners({ x0, y0, x1, y1, tw, rw, bw, lw, tAngle: T.mitreAngle, rAngle: R.mitreAngle, bAngle: B.mitreAngle, lAngle: L.mitreAngle });
  const { TL, TR, BR, BL } = c;
  // Top edge
  shapes.push({ type: "line", layer: "CUT", x1: TL.h.x, y1: TL.h.y, x2: TR.h.x, y2: TR.h.y });
  // TR mitre
  if (!(TR.h.x === TR.v.x && TR.h.y === TR.v.y))
    shapes.push({ type: "line", layer: "CUT", x1: TR.h.x, y1: TR.h.y, x2: TR.v.x, y2: TR.v.y });
  // Right edge
  shapes.push({ type: "line", layer: "CUT", x1: TR.v.x, y1: TR.v.y, x2: BR.v.x, y2: BR.v.y });
  // BR mitre
  if (!(BR.v.x === BR.h.x && BR.v.y === BR.h.y))
    shapes.push({ type: "line", layer: "CUT", x1: BR.v.x, y1: BR.v.y, x2: BR.h.x, y2: BR.h.y });
  // Bottom edge
  shapes.push({ type: "line", layer: "CUT", x1: BR.h.x, y1: BR.h.y, x2: BL.h.x, y2: BL.h.y });
  // BL mitre
  if (!(BL.h.x === BL.v.x && BL.h.y === BL.v.y))
    shapes.push({ type: "line", layer: "CUT", x1: BL.h.x, y1: BL.h.y, x2: BL.v.x, y2: BL.v.y });
  // Left edge
  shapes.push({ type: "line", layer: "CUT", x1: BL.v.x, y1: BL.v.y, x2: TL.v.x, y2: TL.v.y });
  // TL mitre
  if (!(TL.v.x === TL.h.x && TL.v.y === TL.h.y))
    shapes.push({ type: "line", layer: "CUT", x1: TL.v.x, y1: TL.v.y, x2: TL.h.x, y2: TL.h.y });

  return shapes;
}

// ─── CANVAS PREVIEW ─────────────────────────────────────────────────────────────
function Preview({ shapes, totalW, totalH }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const cw = canvas.width, ch = canvas.height;
    ctx.fillStyle = "#0e1525";
    ctx.fillRect(0, 0, cw, ch);
    if (totalW <= 0 || totalH <= 0) return;
    const pad = 44;
    const scale = Math.min((cw - pad * 2) / totalW, (ch - pad * 2) / totalH);
    const ox = (cw - totalW * scale) / 2;
    const oy = (ch - totalH * scale) / 2;
    const tx = x => ox + x * scale;
    const ty = y => ch - oy - y * scale;

    // subtle grid
    ctx.strokeStyle = "#141e30"; ctx.lineWidth = 0.5;
    const step = Math.ceil(totalW / 24) * scale;
    for (let gx = ox % step; gx < cw; gx += step) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke(); }
    const stepY = Math.ceil(totalH / 18) * scale;
    for (let gy = oy % stepY; gy < ch; gy += stepY) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke(); }

    // FREZ first, CUT on top
    const sorted = [...shapes].sort((a, b) => (a.layer === "CUT" ? 1 : 0) - (b.layer === "CUT" ? 1 : 0));
    for (const s of sorted) {
      if (s.type !== "line") continue;
      ctx.beginPath();
      ctx.moveTo(tx(s.x1), ty(s.y1));
      ctx.lineTo(tx(s.x2), ty(s.y2));
      ctx.strokeStyle = s.layer === "CUT" ? "#4ade80" : "#d946ef";
      ctx.lineWidth = s.layer === "CUT" ? 2 : 1.2;
      ctx.stroke();
    }
  }, [shapes, totalW, totalH]);

  return <canvas ref={canvasRef} width={720} height={480}
    style={{ width: "100%", height: "100%", display: "block", borderRadius: 8 }} />;
}

// ─── SMALL COMPONENTS ───────────────────────────────────────────────────────────
const inputSt = { background: "#0a0f1e", border: "1px solid #1e2d4a", borderRadius: 5, color: "#e2e8f0", padding: "3px 8px", width: 74, fontSize: 12, outline: "none" };
function NI({ value, onChange, min = 0, w }) { return <input type="number" min={min} value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} style={{ ...inputSt, ...(w ? { width: w } : {}) }} />; }
function Btn({ onClick, color, bg, children }) { return <button onClick={onClick} style={{ background: bg, color, border: `1px solid ${color}44`, borderRadius: 5, padding: "3px 9px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>{children}</button>; }
function XB({ onClick }) { return <button onClick={onClick} style={{ background: "#200808", color: "#f87171", border: "1px solid #f8717133", borderRadius: 4, padding: "1px 7px", fontSize: 13, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}>×</button>; }

// ─── SIDE EDITOR ────────────────────────────────────────────────────────────────
function SideEditor({ label, side, color, onChange }) {
  const addF = () => onChange({ ...side, flanges: [...side.flanges, { width: 20 }] });
  const addZ = () => onChange({ ...side, frezLines: [...side.frezLines, { depth: 20 }] });
  const rmF = i => onChange({ ...side, flanges: side.flanges.filter((_, j) => j !== i) });
  const rmZ = i => onChange({ ...side, frezLines: side.frezLines.filter((_, j) => j !== i) });
  const upF = (i, v) => onChange({ ...side, flanges: side.flanges.map((f, j) => j === i ? { width: v } : f) });
  const upZ = (i, v) => onChange({ ...side, frezLines: side.frezLines.map((f, j) => j === i ? { depth: v } : f) });

  return (
    <div style={{ background: "#0e1525", border: `1px solid ${color}22`, borderRadius: 9, padding: "11px 13px", marginBottom: 7 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ color, fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>{label}</span>
        <div style={{ display: "flex", gap: 5 }}>
          <Btn onClick={addF} color="#4ade80" bg="#031a0e">＋ Flange</Btn>
          <Btn onClick={addZ} color="#d946ef" bg="#1a0320">＋ Frez</Btn>
        </div>
      </div>
      {side.flanges.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
          <span style={{ color: "#4ade80", fontSize: 10, width: 58 }}>Flange {i + 1}</span>
          <NI value={f.width} onChange={v => upF(i, v)} min={1} />
          <span style={{ color: "#2d4a6e", fontSize: 10 }}>mm out</span>
          <XB onClick={() => rmF(i)} />
        </div>
      ))}
      {side.flanges.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, marginTop: 2 }}>
          <span style={{ color: "#64748b", fontSize: 10, width: 58 }}>Mitre °</span>
          <NI value={side.mitreAngle} onChange={v => onChange({ ...side, mitreAngle: Math.max(1, Math.min(89, v)) })} w={52} />
          <span style={{ color: "#2d4a6e", fontSize: 10 }}>45=sym</span>
        </div>
      )}
      {side.frezLines.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
          <span style={{ color: "#d946ef", fontSize: 10, width: 58 }}>Frez {i + 1}</span>
          <NI value={f.depth} onChange={v => upZ(i, v)} min={1} />
          <span style={{ color: "#2d4a6e", fontSize: 10 }}>mm in</span>
          <XB onClick={() => rmZ(i)} />
        </div>
      ))}
      {side.flanges.length === 0 && side.frezLines.length === 0 && (
        <div style={{ color: "#1e2d4a", fontSize: 10, fontStyle: "italic" }}>empty — add flanges or frez lines</div>
      )}
    </div>
  );
}

// ─── APP ────────────────────────────────────────────────────────────────────────
const mkSide = () => ({ flanges: [], frezLines: [], mitreAngle: 45 });

export default function App() {
  const [st, setSt] = useState({ W: 1021, H: 1458, sides: { top: mkSide(), right: mkSide(), bottom: mkSide(), left: mkSide() } });
  const setSide = useCallback((k, v) => setSt(p => ({ ...p, sides: { ...p.sides, [k]: v } })), []);

  const { W, H, sides } = st;
  const lw = sides.left.flanges.reduce((a, f) => a + f.width, 0);
  const rw = sides.right.flanges.reduce((a, f) => a + f.width, 0);
  const bw = sides.bottom.flanges.reduce((a, f) => a + f.width, 0);
  const tw = sides.top.flanges.reduce((a, f) => a + f.width, 0);
  const totalW = W + lw + rw, totalH = H + bw + tw;

  const shapes = computeShapes({ W, H, sides });

  const exportDXF = () => {
    const blob = new Blob([buildDXF(shapes)], { type: "application/dxf" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `panel-${W}x${H}.dxf`; a.click();
  };

  const sideColors = { top: "#38bdf8", right: "#fb923c", bottom: "#34d399", left: "#a78bfa" };

  return (
    <div style={{ minHeight: "100vh", background: "#080d18", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code',monospace", display: "flex" }}>
      {/* SIDEBAR */}
      <div style={{ width: 295, minWidth: 295, background: "#0a1020", borderRight: "1px solid #111d33", padding: "18px 14px", overflowY: "auto", maxHeight: "100vh" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: "#4ade80", letterSpacing: 3, fontWeight: 700 }}>SHEET METAL</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#f8fafc", letterSpacing: -0.5 }}>DXF Generator</div>
          <div style={{ fontSize: 9, color: "#1e3a5f", marginTop: 2 }}>
            <span style={{ color: "#4ade80" }}>■ CUT layer</span>&nbsp;&nbsp;<span style={{ color: "#d946ef" }}>■ FREZ layer</span>
          </div>
        </div>

        {/* Inner rect */}
        <div style={{ background: "#0e1525", border: "1px solid #1a2a44", borderRadius: 9, padding: "11px 13px", marginBottom: 10 }}>
          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>INNER RECTANGLE → FREZ</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ color: "#475569", fontSize: 10, width: 40 }}>Width</span>
            <NI value={W} onChange={v => setSt(p => ({ ...p, W: v }))} min={1} />
            <span style={{ color: "#334155", fontSize: 10 }}>mm</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#475569", fontSize: 10, width: 40 }}>Height</span>
            <NI value={H} onChange={v => setSt(p => ({ ...p, H: v }))} min={1} />
            <span style={{ color: "#334155", fontSize: 10 }}>mm</span>
          </div>
          <div style={{ marginTop: 8, background: "#080d18", borderRadius: 5, padding: "5px 8px", fontSize: 10, color: "#334155" }}>
            Total: <span style={{ color: "#64748b", fontWeight: 700 }}>{totalW} × {totalH} mm</span>
          </div>
        </div>

        {["top", "right", "bottom", "left"].map(k => (
          <SideEditor key={k} label={k} side={sides[k]} color={sideColors[k]} onChange={v => setSide(k, v)} />
        ))}

        <button onClick={exportDXF} style={{
          width: "100%", marginTop: 10, background: "linear-gradient(135deg,#22c55e,#06b6d4)",
          color: "#030712", border: "none", borderRadius: 8, padding: "11px",
          fontSize: 12, fontWeight: 800, cursor: "pointer", letterSpacing: 1
        }}>↓ EXPORT .DXF</button>
      </div>

      {/* PREVIEW */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 18, gap: 10, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#1e3a5f" }}>Live Preview · mm</span>
          <div style={{ display: "flex", gap: 18, fontSize: 10 }}>
            {[["T", tw, "#38bdf8"], ["R", rw, "#fb923c"], ["B", bw, "#34d399"], ["L", lw, "#a78bfa"]].map(([l, v, c]) => (
              <span key={l} style={{ color: c }}>{l}: <b style={{ color: v > 0 ? c : "#1e3a5f" }}>{v > 0 ? v + " mm" : "—"}</b></span>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, background: "#0e1525", borderRadius: 10, border: "1px solid #111d33", overflow: "hidden", minHeight: 420 }}>
          <Preview shapes={shapes} totalW={totalW} totalH={totalH} />
        </div>
        <div style={{ fontSize: 9, color: "#111d33", textAlign: "right" }}>
          {shapes.filter(x => x.layer === "CUT").length} CUT · {shapes.filter(x => x.layer === "FREZ").length} FREZ
        </div>
      </div>
    </div>
  );
}
