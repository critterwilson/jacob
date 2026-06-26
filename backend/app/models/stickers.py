from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class Sticker(BaseModel):
    slug: str
    name: str
    audience: Literal["christian", "general"]
    order: int
    color: str


class StickerListResponse(BaseModel):
    stickers: list[Sticker]
    etag: str
