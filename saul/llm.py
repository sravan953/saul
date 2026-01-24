import asyncio
import html
import json
import os
from pathlib import Path
from typing import AsyncGenerator

import httpx
import requests
from dotenv import load_dotenv
from loguru import logger
from model import Analysis, AtomizedCaseOutput
from ollama import AsyncClient
from openai import OpenAI

load_dotenv()

LLM_PROVIDER = (
    os.getenv("LLM_PROVIDER", "ollama").strip().lower()
)  # "ollama", "openrouter", or "openai"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = "google/gemma-3-12b-it:free"
OLLAMA_MODEL = "gemma3:12b"
OPENAI_MODEL = "gpt-4o-mini"

PROMPT_TEMPLATE = """
Extract facts, identify legal issues, analyze reasonings, and determine conclusions from this case:

{text}
"""

ATOMIZE_PROMPT_TEMPLATE = """
You are given the facts, legal issues, reasonings, and outcomes from a case.
Classify the case as criminal or civil, then return JSON that matches the schema.
Set only the matching object (criminal or civil) and set the other to null.
Include the legal issues from the input in the output.
For outcome_category, select the most appropriate category for filtering similar cases.
For outcome_details, include specifics like sentence length, damages awarded, or other relevant outcome information.

Facts, issues, reasonings, and outcomes:
{stage1_json}
"""


class OllamaNotRunningError(Exception):
    pass


def build_full_opinion(data: dict) -> str:
    opinions = data.get("casebody", {}).get("opinions", [])
    return "".join(opinion.get("text", "") for opinion in opinions)


def format_analysis_html(analysis: Analysis, case_type: str | None = None) -> str:
    html_output = "<div class='stage1-card'>"
    
    # Header with case type badge
    case_type_display = case_type.upper() if case_type else "Not Classified"
    html_output += f"<div class='stage1-header'><span class='stage1-label'>Case Type</span><span class='stage1-badge'>{html.escape(case_type_display)}</span></div>"
    
    # Facts section
    html_output += "<div class='stage1-section'><div class='stage1-section-title'>Facts</div><ul class='stage1-list'>"
    for fact in analysis.facts:
        html_output += f"<li>{html.escape(fact)}</li>"
    html_output += "</ul></div>"
    
    # Legal Issues section
    html_output += "<div class='stage1-section'><div class='stage1-section-title'>Legal Issues</div><ul class='stage1-list'>"
    for issue in analysis.issues:
        html_output += f"<li>{html.escape(issue)}</li>"
    html_output += "</ul></div>"
    
    # Reasonings section
    html_output += "<div class='stage1-section'><div class='stage1-section-title'>Reasonings</div><ul class='stage1-list'>"
    for reasoning in analysis.reasonings:
        html_output += f"<li>{html.escape(reasoning)}</li>"
    html_output += "</ul></div>"
    
    # Outcome section
    html_output += f"<div class='stage1-section'><div class='stage1-section-title'>Outcome</div><p class='stage1-outcome'>{html.escape(analysis.outcomes)}</p></div>"
    
    html_output += "</div>"
    return html_output


async def _check_ollama() -> None:
    try:
        async with httpx.AsyncClient() as http_client:
            await http_client.get("http://localhost:11434/api/tags", timeout=2.0)
    except (httpx.ConnectError, httpx.TimeoutException):
        raise OllamaNotRunningError(
            "Ollama server not running. Start it with 'ollama serve' or open the Ollama app."
        )


async def call_ollama(
    prompt: str, save_path: Path | None = None
) -> AsyncGenerator[str, None]:
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
    if save_path:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_text(analysis.model_dump_json(indent=2), encoding="utf-8")
    yield format_analysis_html(analysis)


async def _call_ollama_atomize(prompt: str) -> AtomizedCaseOutput:
    client = AsyncClient()
    stream = await client.chat(
        model=OLLAMA_MODEL,
        messages=[{"role": "user", "content": prompt}],
        format=AtomizedCaseOutput.model_json_schema(),
        options={"temperature": 0},
        stream=True,
    )
    full_response = ""
    async for chunk in stream:
        full_response += chunk["message"]["content"]
    return AtomizedCaseOutput.model_validate_json(full_response)


def _call_openrouter(prompt: str, save_path: Path | None = None) -> str:
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
    if save_path:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_text(analysis.model_dump_json(indent=2), encoding="utf-8")
    return format_analysis_html(analysis)


def _call_openrouter_atomize(prompt: str) -> AtomizedCaseOutput:
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
                "content": (
                    "Respond only with valid JSON matching this schema: "
                    f"{json.dumps(AtomizedCaseOutput.model_json_schema())}"
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
    }

    response = requests.post(url, headers=headers, json=payload, timeout=120)
    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    return AtomizedCaseOutput.model_validate_json(content)


async def call_openrouter(
    prompt: str, save_path: Path | None = None
) -> AsyncGenerator[str, None]:
    content = await asyncio.to_thread(_call_openrouter, prompt, save_path)
    yield content


def _call_openai(prompt: str, save_path: Path | None = None) -> str:
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
    if save_path:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_text(
            response.output_parsed.model_dump_json(indent=2), encoding="utf-8"
        )
    return format_analysis_html(response.output_parsed)


def _call_openai_atomize(prompt: str) -> AtomizedCaseOutput:
    client = OpenAI()
    response = client.responses.parse(
        model=OPENAI_MODEL,
        input=[
            {
                "role": "system",
                "content": (
                    "Classify the case as criminal or civil and respond with JSON "
                    "matching the provided schema."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        text_format=AtomizedCaseOutput,
    )
    return response.output_parsed


async def call_openai(
    prompt: str, save_path: Path | None = None
) -> AsyncGenerator[str, None]:
    content = await asyncio.to_thread(_call_openai, prompt, save_path)
    yield content


async def stream_analysis(
    full_opinion: str, save_path: Path | None = None
) -> AsyncGenerator[str, None]:
    """Check provider availability and return the streaming generator."""
    prompt = PROMPT_TEMPLATE.format(text=full_opinion)

    logger.info(f"Using LLM provider: {LLM_PROVIDER}")

    if LLM_PROVIDER == "openrouter":
        return call_openrouter(prompt, save_path)
    elif LLM_PROVIDER == "openai":
        return call_openai(prompt, save_path)
    else:
        await _check_ollama()
        return call_ollama(prompt, save_path)


async def get_case_analysis_stream(
    json_file: Path, output_file: Path, skip_if_exists: bool = False
) -> AsyncGenerator[str, None] | None:
    if skip_if_exists and output_file.exists():
        return None

    data = json.loads(json_file.read_text(encoding="utf-8"))
    full_opinion = build_full_opinion(data)
    return await stream_analysis(full_opinion, save_path=output_file)


async def atomize_analysis(
    analysis: Analysis, save_path: Path | None = None
) -> AtomizedCaseOutput:
    prompt = ATOMIZE_PROMPT_TEMPLATE.format(
        stage1_json=analysis.model_dump_json(indent=2)
    )
    logger.info(f"Using LLM provider for stage 2: {LLM_PROVIDER}")

    if LLM_PROVIDER == "openrouter":
        atomized = await asyncio.to_thread(_call_openrouter_atomize, prompt)
    elif LLM_PROVIDER == "openai":
        atomized = await asyncio.to_thread(_call_openai_atomize, prompt)
    else:
        await _check_ollama()
        atomized = await _call_ollama_atomize(prompt)

    if save_path:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_text(atomized.model_dump_json(indent=2), encoding="utf-8")
    return atomized
