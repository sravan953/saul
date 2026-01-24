import json
import sys
from pathlib import Path
from typing import Optional

sys.path.append(str(Path(__file__).resolve().parent))

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from llm import (
    OllamaNotRunningError,
    atomize_analysis,
    format_analysis_html,
    get_case_analysis_stream,
)
from model import Analysis
from pydantic import BaseModel

load_dotenv()

app = FastAPI()

# Data directories
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "1"
JSON_DIR = DATA_DIR / "json"
HTML_DIR = DATA_DIR / "html"
OUTPUT_STAGE1_DIR = DATA_DIR / "output_stage1"
OUTPUT_STAGE2_DIR = DATA_DIR / "output_stage2"

# Ensure output directories exist
OUTPUT_STAGE1_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_STAGE2_DIR.mkdir(parents=True, exist_ok=True)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def read_index():
    return FileResponse("static/index.html")


@app.get("/api/files")
async def list_files():
    if not JSON_DIR.exists():
        return []
    files = sorted([f.name for f in JSON_DIR.glob("*.json")])
    return files


@app.get("/api/html/{filename}")
async def get_html(filename: str):
    # Filename comes in as the JSON filename, we need to find the corresponding HTML
    html_filename = filename.replace(".json", ".html")
    html_file = HTML_DIR / html_filename

    if not html_file.exists():
        raise HTTPException(status_code=404, detail="HTML file not found")

    return FileResponse(html_file)


@app.get("/api/output/{filename}")
async def get_cached_output(filename: str):
    output_file = OUTPUT_STAGE1_DIR / filename
    if not output_file.exists():
        raise HTTPException(status_code=404, detail="Cached output not found")

    try:
        with open(output_file, "r") as f:
            data = json.load(f)
        analysis = Analysis.model_validate(data)

        # Check if stage 2 output exists to get case type
        case_type = None
        stage2_file = _stage2_output_path(filename)
        if stage2_file.exists():
            try:
                stage2_data = json.loads(stage2_file.read_text(encoding="utf-8"))
                case_type = stage2_data.get("case_type")
            except Exception:
                pass

        from fastapi.responses import HTMLResponse

        return HTMLResponse(content=format_analysis_html(analysis, case_type))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/output/exists/{filename}")
async def output_exists(filename: str):
    output_file = OUTPUT_STAGE1_DIR / filename
    return {"exists": output_file.exists()}


@app.delete("/api/output/{filename}")
async def delete_stage1_output(filename: str):
    output_file = OUTPUT_STAGE1_DIR / filename
    if output_file.exists():
        output_file.unlink()
        return {"deleted": True}
    return {"deleted": False}


def _stage2_output_path(filename: str) -> Path:
    return OUTPUT_STAGE2_DIR / f"{Path(filename).stem}.atomized.json"


@app.get("/api/output_stage2/{filename}")
async def get_stage2_output(filename: str):
    output_file = _stage2_output_path(filename)
    if not output_file.exists():
        raise HTTPException(status_code=404, detail="Stage 2 output not found")
    return json.loads(output_file.read_text(encoding="utf-8"))


@app.get("/api/output_stage2/exists/{filename}")
async def output_stage2_exists(filename: str):
    output_file = _stage2_output_path(filename)
    return {"exists": output_file.exists()}


@app.delete("/api/output_stage2/{filename}")
async def delete_stage2_output(filename: str):
    output_file = _stage2_output_path(filename)
    if output_file.exists():
        output_file.unlink()
        return {"deleted": True}
    return {"deleted": False}


@app.post("/api/analyze/{filename}")
async def analyze_case(filename: str):
    json_file = JSON_DIR / filename
    if not json_file.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Check for cached output
    output_file = OUTPUT_STAGE1_DIR / filename
    if output_file.exists():
        try:
            with open(output_file, "r") as f:
                data = json.load(f)
            analysis = Analysis.model_validate(data)

            # Check if stage 2 output exists to get case type
            case_type = None
            stage2_file = _stage2_output_path(filename)
            if stage2_file.exists():
                try:
                    stage2_data = json.loads(stage2_file.read_text(encoding="utf-8"))
                    case_type = stage2_data.get("case_type")
                except Exception:
                    pass

            return format_analysis_html(analysis, case_type)
        except Exception as e:
            # If cache is invalid, ignore and re-analyze
            print(f"Error reading cache: {e}")

    try:
        stream = await get_case_analysis_stream(json_file, output_file)
        return StreamingResponse(
            stream,
            media_type="text/html",
        )

    except OllamaNotRunningError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/batch/status")
async def batch_status():
    total = len(list(JSON_DIR.glob("*.json"))) if JSON_DIR.exists() else 0
    stage1_processed = (
        len(list(OUTPUT_STAGE1_DIR.glob("*.json"))) if OUTPUT_STAGE1_DIR.exists() else 0
    )
    stage2_processed = (
        len(list(OUTPUT_STAGE2_DIR.glob("*.atomized.json")))
        if OUTPUT_STAGE2_DIR.exists()
        else 0
    )
    stage1_complete = total > 0 and stage1_processed >= total
    stage2_complete = total > 0 and stage2_processed >= total
    return {
        "total": total,
        "stage1_processed": stage1_processed,
        "stage2_processed": stage2_processed,
        "stage1_complete": stage1_complete,
        "stage2_complete": stage2_complete,
    }


class BatchRunRequest(BaseModel):
    limit: Optional[int] = None


@app.post("/api/batch/run")
async def run_batch(request: BatchRunRequest):
    async def stream_progress():
        json_files = sorted(list(JSON_DIR.glob("*.json"))) if JSON_DIR.exists() else []

        if not json_files:
            yield f"data: No JSON files found in {JSON_DIR}\n\n"
            return

        to_process = json_files
        if request.limit:
            to_process = json_files[: request.limit]

        yield f"data: Found {len(json_files)} cases. Processing {len(to_process)}...\n\n"

        processed_count = 0
        skipped_count = 0
        error_count = 0

        for json_file in to_process:
            filename = json_file.name
            output_file = OUTPUT_STAGE1_DIR / filename

            try:
                stream = await get_case_analysis_stream(
                    json_file, output_file, skip_if_exists=True
                )
                if stream is None:
                    skipped_count += 1
                    yield f"data: Skipped {filename} (already processed)\n\n"
                    continue

                yield f"data: Processing {filename}...\n\n"

                async for _ in stream:
                    pass

                processed_count += 1
                yield f"data: Completed {filename}\n\n"

            except Exception as e:
                error_count += 1
                yield f"data: Error processing {filename}: {e}\n\n"

        yield f"data: Done. Processed: {processed_count}, Skipped: {skipped_count}, Errors: {error_count}\n\n"

    return StreamingResponse(stream_progress(), media_type="text/event-stream")


@app.post("/api/analyze_stage2/{filename}")
async def analyze_case_stage2(filename: str):
    json_file = JSON_DIR / filename
    if not json_file.exists():
        raise HTTPException(status_code=404, detail="File not found")

    stage1_file = OUTPUT_STAGE1_DIR / filename
    if not stage1_file.exists():
        raise HTTPException(
            status_code=409, detail="Stage 1 output not found for this case"
        )

    output_file = _stage2_output_path(filename)
    if output_file.exists():
        return json.loads(output_file.read_text(encoding="utf-8"))

    try:
        data = json.loads(stage1_file.read_text(encoding="utf-8"))
        analysis = Analysis.model_validate(data)
        atomized = await atomize_analysis(analysis, save_path=output_file)
        return atomized.model_dump()
    except OllamaNotRunningError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/atlas/cases")
async def get_atlas_cases():
    """Return all stage 2 outputs with filenames for the Case Atlas view."""
    cases = []
    if OUTPUT_STAGE2_DIR.exists():
        for output_file in sorted(OUTPUT_STAGE2_DIR.glob("*.atomized.json")):
            try:
                data = json.loads(output_file.read_text(encoding="utf-8"))
                # Reconstruct original filename from atomized filename
                filename = output_file.stem.replace(".atomized", "") + ".json"
                cases.append({"filename": filename, **data})
            except Exception:
                continue
    return cases


@app.post("/api/batch/run-stage2")
async def run_batch_stage2(request: BatchRunRequest):
    async def stream_progress():
        json_files = sorted(list(JSON_DIR.glob("*.json"))) if JSON_DIR.exists() else []

        if not json_files:
            yield f"data: No JSON files found in {JSON_DIR}\n\n"
            return

        to_process = json_files
        if request.limit:
            to_process = json_files[: request.limit]

        yield f"data: Found {len(json_files)} cases. Processing {len(to_process)}...\n\n"

        processed_count = 0
        skipped_count = 0
        error_count = 0

        for json_file in to_process:
            filename = json_file.name
            stage1_file = OUTPUT_STAGE1_DIR / filename
            output_file = _stage2_output_path(filename)

            if not stage1_file.exists():
                skipped_count += 1
                yield f"data: Skipped {filename} (stage 1 missing)\n\n"
                continue

            if output_file.exists():
                skipped_count += 1
                yield f"data: Skipped {filename} (already processed)\n\n"
                continue

            try:
                data = json.loads(stage1_file.read_text(encoding="utf-8"))
                analysis = Analysis.model_validate(data)
                yield f"data: Processing {filename}...\n\n"

                await atomize_analysis(analysis, save_path=output_file)

                processed_count += 1
                yield f"data: Completed {filename}\n\n"
            except Exception as e:
                error_count += 1
                yield f"data: Error processing {filename}: {e}\n\n"

        yield (
            f"data: Done. Processed: {processed_count}, Skipped: {skipped_count}, "
            f"Errors: {error_count}\n\n"
        )

    return StreamingResponse(stream_progress(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("saul:app", host="0.0.0.0", port=8000, reload=True)
