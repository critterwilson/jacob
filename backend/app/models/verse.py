from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class DailyVerseResponse(BaseModel):
    day: str  # YYYY-MM-DD, the doc id used in Firestore
    reference: str
    translation: Literal["WEB", "KJV"]
    text: str
    source: Literal["bible-api.com", "calendar-override"]
