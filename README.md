# Saul

A legal analysis copilot that extracts structured information from case law and builds the foundation for precedent-based legal prediction. Read more about the genesis of this idea on my blog [here](https://ksr.bearblog.dev/is-law-a-maximization-problem/).

## Overview

Saul implements a multi-step legal prediction workflow that transforms unstructured case text into structured, queryable data. The system extracts material facts, legal reasoning, and outcomes from case opinions—enabling similarity-based retrieval and precedent analysis.

---

## Legal Prediction Workflow

### Step 1: Input Definitions

Define the core inputs required to initiate the search.

- **Target Case ($C$):** The current legal matter under argument, containing unstructured text.
- **Desired Outcome ($M_{desired}$):** The goal for the client (e.g., "Motion Granted", "Not Guilty").
- **Oracle Database ($O$):** The universal repository of all precedent, where each case $p$ is structured as a tuple:

$$p = \{ F_p, R_p, M_p, Auth_p \}$$

| Component | Description |
|-----------|-------------|
| $F_p$ | Set of material facts |
| $R_p$ | Legal reasoning/rationale |
| $M_p$ | Outcome/Holding |
| $Auth_p$ | Authority level of the court |

---

### Step 2: Ingestion & Extraction ✅ *Implemented*

Convert the unstructured input case into a structured set of material facts.

**Process:** Ingest $C$ and extract material facts to form the **Target Fact Set** $F_{target}$.

$$F_{target} = \{ f_1, f_2, \dots, f_n \}$$

Where each $f_i$ represents a distinct, legally relevant fact (e.g., "warrantless search", "exigent circumstances").

---

### Step 3: Retrieval (The "Broad Net")

Query the Oracle $O$ to retrieve a Candidate Set $D$ of potentially relevant cases based on fact overlap.

**Logic:** Filter for cases where the intersection of facts meets a minimum threshold ($k$).

$$D = \{ p \in O \mid | F_p \cap F_{target} | \geq k \}$$

Alternatively, using a similarity threshold $V_T$:

$$D = \{ p \in O \mid Similarity(F_p, F_{target}) \geq V_T \}$$

---

### Step 4: Distinction Analysis (The Filter)

Identify "hazardous" precedents where minor fact differences might flip the legal outcome.

**The Delta Calculation:**

$$\Delta_p = F_p \setminus F_{target}$$

Facts present in the precedent $p$ but **missing** from the current case $C$.

**The Check:**
- **IF** $\Delta_p$ contains **Outcome-Determinative Negations** (e.g., "consensual" vs. "non-consensual", "public" vs. "private"):
  - Flag $p$ as **Distinguishable / Hazardous**
- **ELSE:**
  - Retain $p$ as a **Valid Analogous Precedent**

---

### Step 5: Ranking & Scoring

Rank the valid precedents in $D$ to determine which arguments are strongest.

**Scoring Function ($S$):**

$$S(p) = w_1 \cdot Sim(F_p, F_{target}) + w_2 \cdot Auth(p) + w_3 \cdot Align(M_p, M_{desired})$$

| Variable | Description |
|----------|-------------|
| $Sim(F_p, F_{target})$ | Extent of factual overlap (from Step 3) |
| $Auth(p)$ | Binding power of the court (e.g., Supreme Court = 1.0, District Court = 0.5) |
| $Align(M_p, M_{desired})$ | +1 if outcomes match, -1 if adverse |
| $w_{1,2,3}$ | Tunable weights |

**Output:** Sort $D$ by $S(p)$ descending and select top $N$ cases.

---

## Current Implementation

The current codebase implements **Step 2: Ingestion & Extraction** with:

- **FastAPI web interface** for browsing and analyzing cases
- **Multi-provider LLM support** (Ollama, OpenRouter, OpenAI)
- **Structured extraction** using Pydantic models
- **Batch processing** for bulk case analysis

### Extracted Structure

```python
class Analysis:
    facts: list[str]       # Material facts from the case
    reasonings: list[str]  # Legal reasoning/rationale
    outcomes: str          # Case outcome/holding
```

---

## Setup

### Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) package manager
- One of: Ollama, OpenRouter API key, or OpenAI API key

### Installation

```bash
# Clone and navigate to project
cd saul

# Install dependencies
uv sync
```

### Configuration

Create a `.env` file:

```env
# LLM Provider: "ollama", "openrouter", or "openai"
LLM_PROVIDER=ollama

# Required for OpenRouter
OPENROUTER_API_KEY=your_key_here

# Required for OpenAI
OPENAI_API_KEY=your_key_here
```

### Data Setup

Place case JSON files (e.g., from [Caselaw Access Project](https://case.law/)) in:

```
data/1/json/   # Case JSON files
data/1/html/   # Corresponding HTML views (optional)
```

For the current implementation, I downloaded [Reports of Cases Determined in the Supreme Court of the State of California (2016-2016).](https://case.law/caselaw/?reporter=cal-5th)

---

## Usage

### Web Interface

```bash
uv run saul/saul.py
```

Open `http://localhost:8000` to browse cases and run analysis.

### Batch Processing

```bash
uv run saul/batch_process.py
```

Processes all cases in `data/1/json/` and saves structured output to `data/1/output/`.

---

## Project Structure

```
saul/
├── saul/
│   ├── saul.py          # FastAPI web server
│   ├── llm.py           # LLM provider abstraction
│   ├── model.py         # Pydantic data models
│   ├── analysis.py      # Standalone analysis script
│   └── batch_process.py # Bulk processing script
├── static/
│   ├── index.html       # Web UI
│   ├── script.js        # Frontend logic
│   └── style.css        # Styles
├── data/                # Case data (not tracked)
├── pyproject.toml
└── README.md
```

---

## License

MIT
