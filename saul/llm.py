import asyncio
import json
import os
from typing import AsyncGenerator

import httpx
import requests
from dotenv import load_dotenv
from model import Analysis
from ollama import AsyncClient
from openai import OpenAI

load_dotenv()

LLM_PROVIDER = os.getenv(
    "LLM_PROVIDER", "ollama"
)  # "ollama", "openrouter", or "openai"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = "google/gemma-3-12b-it:free"
OLLAMA_MODEL = "gemma3:12b"
OPENAI_MODEL = "gpt-4o-mini"

PROMPT_TEMPLATE = """
Extract facts, reasonings, and conclusions from this case:

{text}
"""


class OllamaNotRunningError(Exception):
    pass


def format_analysis_html(analysis: Analysis) -> str:
    html = "<div class='analysis'>"

    html += "<h3>Facts</h3><ul>"
    for fact in analysis.facts:
        html += f"<li>{fact}</li>"
    html += "</ul>"

    html += "<h3>Reasonings</h3><ul>"
    for reasoning in analysis.reasonings:
        html += f"<li>{reasoning}</li>"
    html += "</ul>"

    html += f"<h3>Outcome</h3><p>{analysis.outcomes}</p>"

    html += "</div>"
    return html


async def _check_ollama() -> None:
    try:
        async with httpx.AsyncClient() as http_client:
            await http_client.get("http://localhost:11434/api/tags", timeout=2.0)
    except (httpx.ConnectError, httpx.TimeoutException):
        raise OllamaNotRunningError(
            "Ollama server not running. Start it with 'ollama serve' or open the Ollama app."
        )


async def call_ollama(prompt: str) -> AsyncGenerator[str, None]:
    client = AsyncClient()
    stream = await client.chat(
        model=OLLAMA_MODEL,
        messages=[{"role": "user", "content": prompt}],
        format=Analysis.model_json_schema(),
        options={"temperature": 0},
        stream=True,
    )
    full_response = ""
    async for chunk in stream:
        full_response += chunk["message"]["content"]
    analysis = Analysis.model_validate_json(full_response)
    yield format_analysis_html(analysis)


def _call_openrouter(prompt: str) -> str:
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {
                "role": "system",
                "content": f"Respond only with valid JSON matching this schema: {json.dumps(Analysis.model_json_schema())}",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
    }

    response = requests.post(url, headers=headers, json=payload, timeout=120)
    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    analysis = Analysis.model_validate_json(content)
    return format_analysis_html(analysis)


async def call_openrouter(prompt: str) -> AsyncGenerator[str, None]:
    content = await asyncio.to_thread(_call_openrouter, prompt)
    yield content


def _call_openai(prompt: str) -> str:
    client = OpenAI()
    response = client.responses.parse(
        model=OPENAI_MODEL,
        input=[
            {
                "role": "system",
                "content": "Extract facts, reasonings, and conclusions from this case.",
            },
            {"role": "user", "content": prompt},
        ],
        text_format=Analysis,
    )
    return format_analysis_html(response.output_parsed)


async def call_openai(prompt: str) -> AsyncGenerator[str, None]:
    content = await asyncio.to_thread(_call_openai, prompt)
    yield content


async def stream_analysis(full_opinion: str) -> AsyncGenerator[str, None]:
    """Check provider availability and return the streaming generator."""
    prompt = PROMPT_TEMPLATE.format(text=full_opinion)

    if LLM_PROVIDER == "openrouter":
        return call_openrouter(prompt)
    elif LLM_PROVIDER == "openai":
        return call_openai(prompt)
    else:
        await _check_ollama()
        return call_ollama(prompt)
