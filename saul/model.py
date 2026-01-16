from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class Analysis(BaseModel):
    facts: list[str] = Field(description="List of facts from the case.")
    reasonings: list[str] = Field(description="List of reasonings from the case.")
    outcomes: str = Field(description="Outcome of the case.")


# Shared Base for common legal entities
class LegalEntity(BaseModel):
    role: Literal["Plaintiff", "Defendant", "Prosecution", "Victim"]
    type: Literal["Individual", "Organization", "State"]
    name: Optional[str] = None


# 1. Criminal Case Model
class CriminalAtomizedCase(BaseModel):
    offense_severity: Literal["Infraction", "Misdemeanor", "Felony"]
    charges: List[str] = Field(
        description="List of specific charges (e.g., 'First-degree murder')"
    )
    weapon_type: Optional[str] = Field(
        None, description="Specific weapon used, e.g., '9mm Handgun'"
    )
    victim_count: int = Field(..., ge=0)
    evidence_types: List[str] = Field(description="e.g., DNA, Ballistics, Witness")
    aggravating_factors: List[str] = Field(default_factory=list)
    prior_record_severity: Literal["None", "Low", "High"]


# 2. Civil (Negligence) Case Model
class CivilAtomizedCase(BaseModel):
    cause_of_action: str = "Negligence"
    duty_of_care_source: str = Field(
        description="Source of duty, e.g., 'Roadway Safety'"
    )
    breach_description: str = Field(description="The act that failed the duty")
    proximate_causation_score: float = Field(
        description="Calculated likelihood that breach caused injury", ge=0, le=1
    )
    damages_claimed: float = Field(description="Monetary amount in USD")
    is_settlement: bool = False


class AtomizedCaseOutput(BaseModel):
    case_type: Literal["criminal", "civil"]
    criminal: Optional[CriminalAtomizedCase] = None
    civil: Optional[CivilAtomizedCase] = None

    @model_validator(mode="after")
    def validate_case_data(self):
        if self.case_type == "criminal" and self.criminal is None:
            raise ValueError("criminal case_type requires criminal data")
        if self.case_type == "civil" and self.civil is None:
            raise ValueError("civil case_type requires civil data")
        return self
