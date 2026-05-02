from pydantic import BaseModel, Field


class SubmitReportRequest(BaseModel):
    resourceRef: str = Field(..., description="Firestore path to the reported resource")
    reason: str = Field(..., min_length=1, max_length=500)


class SubmitReportResponse(BaseModel):
    reportId: str
