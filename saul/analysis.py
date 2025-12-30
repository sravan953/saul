import json
import os
import sys
from pathlib import Path

sys.path.append(Path(__file__).resolve().parent)

from dotenv import load_dotenv
from model import Analysis
from ollama import chat

load_dotenv()

root_dir = "/Users/sravan953/Documents/Projects/saul/data/1/json/"
json_files = list(Path(root_dir).glob("*.json"))
file = json_files[0]
print(file)

with open(file, "r") as f:
    data = json.load(f)

opinions = data["casebody"]["opinions"]
full_opinion = ""
for opinion in opinions:
    full_opinion += opinion["text"]


prompt = f"""
Extract facts, reasonings, and conclusions from this case:

{full_opinion}
"""

response_stream = chat(
    model="gemma3:12b",
    messages=[{"role": "user", "content": prompt}],
    format=Analysis.model_json_schema(),  # Use Pydantic to generate the schema or format=schema
    options={"temperature": 0},  # Make responses more deterministic
    stream=True,
)


full_response_content = ""
for chunk in response_stream:
    # The content of each chunk is the streamed JSON response
    content = chunk["message"]["content"]
    full_response_content += content
    print(content, end="", flush=True)

response_analysis = Analysis.model_validate_json(full_response_content)
print(response_analysis)
