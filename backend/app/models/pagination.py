"""Shared cursor-based pagination query params for list endpoints."""

from __future__ import annotations

from fastapi import Query


class PaginationParams:
    """cursor + limit query params used by most paginated list endpoints.

    Use as ``pagination: PaginationParams = Depends()`` in route signatures
    for endpoints whose bounds are ``ge=1, le=100`` and default page size
    is 50.  Endpoints with different bounds or defaults should declare their
    own inline params.
    """

    def __init__(
        self,
        limit: int = Query(default=50, ge=1, le=100),
        cursor: str | None = Query(default=None),
    ) -> None:
        self.limit = limit
        self.cursor = cursor
