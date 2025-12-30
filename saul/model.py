from pydantic import BaseModel, Field


class Analysis(BaseModel):
    facts: list[str] = Field(description="List of facts from the case.")
    reasonings: list[str] = Field(description="List of reasonings from the case.")
    outcomes: str = Field(description="Outcome of the case.")
