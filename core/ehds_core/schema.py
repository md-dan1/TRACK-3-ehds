"""The request format of requests/R*.json; every intake mode produces one of these."""

from typing import Literal

from pydantic import BaseModel, Field

HEALTH_DATA_REQUEST = "health data request"
ACCESS_APPLICATION = "health data access application"


class Applicant(BaseModel):
    name: str = Field(min_length=1)
    organisation: str = Field(min_length=1)
    country: str = Field(min_length=2, max_length=2)


class DataRequest(BaseModel):
    id: str | None = None
    submitted: str | None = None
    applicant: Applicant
    requested_as: Literal["health data request", "health data access application"]
    requested_format: str = "anonymised statistics"
    purpose: str = Field(min_length=1)
    question: str = Field(min_length=1)
    definitions: list[str] = Field(min_length=1)

    @property
    def is_application(self) -> bool:
        return self.requested_as == ACCESS_APPLICATION

    def llm_view(self) -> dict:
        """What the LLM sees: request text only."""
        return {
            "applicant": self.applicant.model_dump(),
            "requested_as": self.requested_as,
            "requested_format": self.requested_format,
            "purpose": self.purpose,
            "question": self.question,
            "definitions": self.definitions,
        }
