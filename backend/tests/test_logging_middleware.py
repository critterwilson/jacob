"""Tests for the structured logging middleware."""

from __future__ import annotations

import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.middleware.logging import StructuredLoggingMiddleware


def _make_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(StructuredLoggingMiddleware)

    @app.get("/ok")
    def ok() -> dict[str, str]:
        return {"result": "ok"}

    @app.get("/authed")
    def authed(request: Request) -> dict[str, str]:
        request.state.uid = "test-uid"
        return {"result": "ok"}

    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(_make_app())


def test_logging_emits_json(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.middleware.logging"):
        client.get("/ok")

    records = [r for r in caplog.records if r.name == "app.middleware.logging"]
    assert len(records) == 1
    log = json.loads(records[0].message)
    assert log["route"] == "/ok"
    assert log["status"] == 200
    assert "request_id" in log
    assert "latency_ms" in log
    assert isinstance(log["latency_ms"], float)


def test_logging_uid_is_none_for_unauthenticated(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app.middleware.logging"):
        client.get("/ok")

    log = json.loads(caplog.records[0].message)
    assert log["uid"] is None


def test_logging_includes_uid_when_set_on_state(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app.middleware.logging"):
        client.get("/authed")

    log = json.loads(caplog.records[0].message)
    assert log["uid"] == "test-uid"


def test_request_id_header_in_response(client: TestClient) -> None:
    response = client.get("/ok")
    assert "x-request-id" in response.headers


def test_request_id_is_unique_per_request(client: TestClient) -> None:
    r1 = client.get("/ok")
    r2 = client.get("/ok")
    assert r1.headers["x-request-id"] != r2.headers["x-request-id"]


def test_method_logged(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.middleware.logging"):
        client.get("/ok")

    log = json.loads(caplog.records[0].message)
    assert log["method"] == "GET"
