import json
import sys
from pathlib import Path
from typing import Optional

sys.path.append(str(Path(__file__).resolve().parent))

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from llm import OllamaNotRunningError, format_analysis_html, get_case_analysis_stream
from model import Analysis
from pydantic import BaseModel

load_dotenv()

app = FastAPI()

# Data directories
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "1"
JSON_DIR = DATA_DIR / "json"
HTML_DIR = DATA_DIR / "html"
OUTPUT_DIR = DATA_DIR / "output"

# Ensure output directory exists
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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
    output_file = OUTPUT_DIR / filename
    if not output_file.exists():
        raise HTTPException(status_code=404, detail="Cached output not found")

    try:
        with open(output_file, "r") as f:
            data = json.load(f)
        analysis = Analysis.model_validate(data)
        # Note: returning HTML string directly. FastAPI will wrap it in JSONResponse by default.
        # Ideally we want to return HTML content.
        from fastapi.responses import HTMLResponse

        return HTMLResponse(content=format_analysis_html(analysis))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/analyze/{filename}")
async def analyze_case(filename: str):
    json_file = JSON_DIR / filename
    if not json_file.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Check for cached output
    output_file = OUTPUT_DIR / filename
    if output_file.exists():
        try:
            with open(output_file, "r") as f:
                data = json.load(f)
            analysis = Analysis.model_validate(data)
            return format_analysis_html(analysis)
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
    processed = len(list(OUTPUT_DIR.glob("*.json"))) if OUTPUT_DIR.exists() else 0
    return {"total": total, "processed": processed}


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
            output_file = OUTPUT_DIR / filename

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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("saul:app", host="0.0.0.0", port=8000, reload=True)
