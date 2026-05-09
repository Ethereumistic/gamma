# main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import tempfile, uuid, os, pathlib, logging
from typing import Optional

logger = logging.getLogger("cnc_pipeline")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter('%(levelname)s - %(name)s - %(message)s'))
    logger.addHandler(_handler)

from cnc_pipeline.pipeline import run_pipeline, PipelineResult

app = FastAPI(title="AluGamma CNC Pipeline", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:4173",   # Vite preview
        "https://cnc.alubeta.com", # CNC pipeline backend
        "https://alubeta.com",     #Frontend
        "https://gamma-iota-five.vercel.app", #Frontend Vercel
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory job store keyed by UUID
# Sufficient for single-operator local use
_jobs: dict[str, PipelineResult] = {}


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.post("/api/generate")
async def generate(
    file: UploadFile = File(...),
    algorithm: str = Form("juggler_gemini"),
    tool_overrides: Optional[str] = Form(None),
    custom_sequence: Optional[str] = Form(None),
):
    if not file.filename.lower().endswith(".dxf"):
        raise HTTPException(status_code=400, detail="Only .dxf files are accepted")

    import json
    overrides = None
    if tool_overrides:
        try:
            overrides = json.loads(tool_overrides)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid tool_overrides JSON")

    parsed_custom_sequence = None
    if custom_sequence:
        try:
            parsed_custom_sequence = json.loads(custom_sequence)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid custom_sequence JSON")

    logger.info(f"custom_sequence received: {parsed_custom_sequence}")

    contents = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="wb")
    tmp.write(contents)
    tmp.close()

    try:
        result = run_pipeline(tmp.name, original_filename=file.filename, algorithm=algorithm, tool_overrides=overrides, custom_sequence=parsed_custom_sequence)
        job_id = str(uuid.uuid4())
        _jobs[job_id] = result
        return {
            "generate": {
                "job_id":          job_id,
                "filename":        file.filename,
                "scenario":        result.scenario,
                "layers_detected": result.layers_detected,
                "tools_used":      result.tools_used,
                "contour_count":   result.contour_count,
                "lift_count":      result.lift_count,
                "estimated_time":  result.estimated_time_seconds,
                "warnings":        result.warnings,
                "algorithm":       algorithm,
                "line_to_segment_map": result.line_to_segment_map,
                "contours_by_layer": result.contours_by_layer,
                "stock_bbox": result.stock_bbox,
            },
            "geometry": result.geometry_data
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")
    finally:
        os.unlink(tmp.name)


from pydantic import BaseModel
from typing import Optional


class RegenerateRequest(BaseModel):
    contours_by_layer: dict[str, list[dict]]
    stock_bbox: dict
    scenario: str
    algorithm: str
    tool_overrides: Optional[dict] = None
    custom_sequence: Optional[list[list]] = None

@app.post("/api/regenerate")
async def regenerate(req: RegenerateRequest):
    from cnc_pipeline.pipeline import run_from_contours

    logger.info(f"regenerate custom_sequence: {req.custom_sequence}")

    try:
        result = run_from_contours(
            contours_by_layer=req.contours_by_layer,
            stock_bbox=req.stock_bbox,
            scenario=req.scenario,
            algorithm=req.algorithm,
            tool_overrides=req.tool_overrides,
            custom_sequence=req.custom_sequence,
        )

        job_id = str(uuid.uuid4())
        # Store a mock dummy result just for download/preview if needed
        # Or you could assemble a full PipelineResult if you want it downloadable
        from cnc_pipeline.pipeline import PipelineResult
        _jobs[job_id] = PipelineResult(
            scenario=req.scenario,
            layers_detected=list(req.contours_by_layer.keys()),
            tools_used=result["tools_used"],
            contour_count=0, # Don't care to recount
            lift_count=result["lift_count"],
            estimated_time_seconds=result["estimated_time"],
            warnings=result["warnings"],
            nc_text=result["nc_text"],
            output_filename=result["output_filename"],
            geometry_data=result["geometry_data"],
            line_to_segment_map=result["line_to_segment_map"],
            contours_by_layer=req.contours_by_layer,
            stock_bbox=req.stock_bbox,
        )

        return {
            "job_id": job_id,
            "scenario": req.scenario,
            "algorithm": req.algorithm,
            "geometry_data": result["geometry_data"],
            "line_to_segment_map": result["line_to_segment_map"],
            "estimated_time": result["estimated_time"],
            "nc_text": result["nc_text"],
            "contours_by_layer": req.contours_by_layer,
            "stock_bbox": req.stock_bbox,
            "tools_used": result["tools_used"],
            "lift_count": result["lift_count"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Regenerate error: {str(e)}")


@app.get("/api/preview/{job_id}")
def preview(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return JSONResponse({"nc_text": _jobs[job_id].nc_text})


@app.get("/api/download/{job_id}")
def download(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    result = _jobs[job_id]

    tmp = tempfile.NamedTemporaryFile(
        suffix=".nc", delete=False, mode="w", encoding="utf-8"
    )
    tmp.write(result.nc_text)
    tmp.close()

    return FileResponse(
        path=tmp.name,
        media_type="application/octet-stream",
        filename=result.output_filename,
    )


@app.post("/api/diagnose-layers")
async def diagnose_layers(file: UploadFile = File(...)):
    """
    Debug endpoint — upload a DXF and get a full report of every layer:
    how many DXF entities are on it, how many segments get extracted,
    and a sample of the first coordinate. Use this to verify reference
    layers (SHEETS, 0) are actually present and readable in the file.
    """
    if not file.filename.lower().endswith(".dxf"):
        raise HTTPException(status_code=400, detail="Only .dxf files are accepted")

    contents = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="wb")
    tmp.write(contents)
    tmp.close()

    try:
        from cnc_pipeline.dxf_reader import DXFReader
        import ezdxf

        reader = DXFReader(tmp.name)
        report = []

        for layer in sorted(reader.layers):
            # Count raw DXF entities on this layer
            entity_count = sum(
                1 for e in reader.msp.query(f'*[layer=="{layer}"]')
            )
            entity_types = list(set(
                e.dxftype() for e in reader.msp.query(f'*[layer=="{layer}"]')
            ))

            # Count extracted contours
            contours = reader.get_contours(layer)

            sample = None
            if contours and contours[0].points:
                p = contours[0].points[0]
                sample = {
                    "x": round(p.x, 3),
                    "y": round(p.y, 3),
                }

            report.append({
                "layer":          layer,
                "entity_count":   entity_count,
                "entity_types":   entity_types,
                "contour_count":  len(contours),
                "sample_point":   sample,
            })

        return {"layers": report, "total_layers": len(report)}

    finally:
        os.unlink(tmp.name)