# main.py
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import tempfile, uuid, os, pathlib

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
async def generate(file: UploadFile = File(...), algorithm: str = "raptor"):
    if not file.filename.lower().endswith(".dxf"):
        raise HTTPException(status_code=400, detail="Only .dxf files are accepted")

    contents = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="wb")
    tmp.write(contents)
    tmp.close()

    try:
        result = run_pipeline(tmp.name, original_filename=file.filename, algorithm=algorithm)
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
            },
            "geometry": result.geometry_data
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")
    finally:
        os.unlink(tmp.name)


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