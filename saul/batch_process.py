import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))

from llm import get_case_analysis_stream
from tqdm import tqdm

# Data directories
# File is in Project/saul/saul/batch_process.py
# parent -> Project/saul/saul
# parent.parent -> Project/saul (Project Root)
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "1"
JSON_DIR = DATA_DIR / "json"
OUTPUT_STAGE1_DIR = DATA_DIR / "output_stage1"


async def process_case(json_file: Path):
    """
    Process a single case file: read JSON, extract text, run analysis, save output.
    """
    filename = json_file.name
    output_file = OUTPUT_STAGE1_DIR / filename

    try:
        stream = await get_case_analysis_stream(
            json_file, output_file, skip_if_exists=True
        )
        if stream is None:
            return "skipped"

        async for _ in stream:
            pass

        return "processed"

    except Exception as e:
        print(f"Error processing {filename}: {e}")
        return "error"


async def main(limit: int | None = None):
    # Ensure output directory exists
    OUTPUT_STAGE1_DIR.mkdir(parents=True, exist_ok=True)

    json_files = sorted(list(JSON_DIR.glob("*.json")))

    if not json_files:
        print(f"No JSON files found in {JSON_DIR}")
        return

    print(f"Found {len(json_files)} cases.")

    # Apply limit
    to_process = json_files
    if limit:
        to_process = json_files[:limit]

    processed_count = 0
    skipped_count = 0
    error_count = 0

    pbar = tqdm(to_process, desc="Processing cases")
    for json_file in pbar:
        status = await process_case(json_file)
        if status == "processed":
            processed_count += 1
        elif status == "skipped":
            skipped_count += 1
        else:
            error_count += 1

        pbar.set_postfix(
            {"new": processed_count, "skip": skipped_count, "err": error_count}
        )

    print(
        f"\nDone. Processed: {processed_count}, Skipped: {skipped_count}, Errors: {error_count}"
    )


if __name__ == "__main__":
    # Configure run here
    LIMIT = None  # Set to None for all
    asyncio.run(main(limit=LIMIT))
