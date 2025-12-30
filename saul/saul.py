import json
import sys
from pathlib import Path

sys.path.append(Path(__file__).resolve().parent)

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from llm import OllamaNotRunningError, stream_analysis

load_dotenv()

app = FastAPI()

# Data directories
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "1"
JSON_DIR = DATA_DIR / "json"
HTML_DIR = DATA_DIR / "html"

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


@app.post("/api/analyze/{filename}")
async def analyze_case(filename: str):
    json_file = JSON_DIR / filename
    if not json_file.exists():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        with open(json_file, "r") as f:
            data = json.load(f)

        opinions = data.get("casebody", {}).get("opinions", [])
        full_opinion = ""
        for opinion in opinions:
            full_opinion += opinion.get("text", "")

        return StreamingResponse(
            await stream_analysis(full_opinion), media_type="text/html"
        )

    except OllamaNotRunningError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("saul:app", host="0.0.0.0", port=8000, reload=True)
