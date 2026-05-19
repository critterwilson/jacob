"""Tests for the SSE chat stream endpoint and the StreamHub (M5 / ADR 0013)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.messages import router as messages_router
from app.services.stream_hub import StreamHub, reset_stream_hub_for_tests


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    limiter.enabled = False
    yield
    limiter.enabled = True


@pytest.fixture(autouse=True)
def _fresh_hub() -> None:
    """Each test gets a clean StreamHub singleton."""
    reset_stream_hub_for_tests()
    yield
    reset_stream_hub_for_tests()


def _app(user: CurrentUser | None = None) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(  # type: ignore[arg-type]
        RequestValidationError, validation_exception_handler
    )
    app.state.limiter = limiter
    app.include_router(messages_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _member_setup(*, group_exists: bool, member_exists: bool, role: str = "member") -> Any:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = group_exists
    group_snap.to_dict.return_value = {"isPrivate": False, "name": "g"}
    member_snap = MagicMock()
    member_snap.exists = member_exists
    member_snap.to_dict.return_value = {"role": role}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    group_ref.collection.return_value.document.return_value = member_ref
    db.collection.return_value.document.return_value = group_ref
    return db


# ── endpoint-level tests ─────────────────────────────────────────────────


def test_stream_requires_authentication() -> None:
    db = _member_setup(group_exists=True, member_exists=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user=None))
        # No `dependency_overrides[get_current_user]` and no Authorization
        # header → the dep raises 401.
        res = client.get("/api/groups/g1/messages/stream")
    assert res.status_code == 401


def test_stream_returns_403_for_non_member_of_private_group() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": True, "name": "g"}
    member_snap = MagicMock()
    member_snap.exists = False
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    group_ref.collection.return_value.document.return_value = member_ref
    db.collection.return_value.document.return_value = group_ref
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages/stream")
    assert res.status_code == 403


def test_stream_returns_503_when_kill_switch_is_on() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _member_setup(group_exists=True, member_exists=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        from app.config import get_settings

        get_settings.cache_clear()
        try:
            with patch.dict("os.environ", {"JACOB_MESSAGES_STREAM_DISABLED": "1"}, clear=False):
                # Reload settings inside the env patch.
                get_settings.cache_clear()
                client = TestClient(_app(user))
                res = client.get("/api/groups/g1/messages/stream")
        finally:
            get_settings.cache_clear()
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "stream_disabled"


@pytest.mark.asyncio
async def test_stream_generator_emits_connected_comment_first() -> None:
    """First frame emitted by the generator is the `: connected` SSE comment.

    Driven against the generator directly (rather than the FastAPI
    TestClient) because `StreamingResponse` over the sync TestClient
    buffers chunk boundaries and would deadlock. The async generator is
    the contract that matters anyway — the endpoint just wraps it.
    """
    from unittest.mock import AsyncMock

    from app.deps import MembershipContext
    from app.routers.messages import _stream_event_generator

    ctx = MembershipContext(gid="g1", uid="alice", role="member", group={})
    fake_request = MagicMock()
    fake_request.is_disconnected = AsyncMock(return_value=True)

    with patch("app.services.stream_hub.StreamHub._attach_listener", lambda self, gid: None):
        gen = _stream_event_generator(fake_request, gid="g1", ctx=ctx)
        # Pull frames until the disconnect-true causes the loop to break.
        first = await gen.__anext__()
        assert first == b": connected\n\n"
        # The next iteration sees is_disconnected==True and exits.
        with pytest.raises(StopAsyncIteration):
            await gen.__anext__()


@pytest.mark.asyncio
async def test_stream_generator_pushes_message_frame_on_event() -> None:
    """A queued ADDED event becomes an `event: message` SSE frame."""

    from app.deps import MembershipContext
    from app.routers.messages import _stream_event_generator
    from app.services.stream_hub import get_stream_hub

    ctx = MembershipContext(gid="g1", uid="alice", role="member", group={})

    # `is_disconnected` returns False once (so the loop pulls one event),
    # then True (so the loop exits after that event).
    disconnect_calls = {"n": 0}

    async def fake_disconnected() -> bool:
        disconnect_calls["n"] += 1
        return disconnect_calls["n"] > 1

    fake_request = MagicMock()
    fake_request.is_disconnected = fake_disconnected

    with patch("app.services.stream_hub.StreamHub._attach_listener", lambda self, gid: None):
        # Seed an event onto the queue ourselves by pre-subscribing.
        hub = get_stream_hub()
        seeded_queue = await hub.subscribe("g1")
        await seeded_queue.put(
            {
                "id": "m42",
                "data": {
                    "authorUid": "bob",
                    "body": "hello world",
                    "createdAt": datetime.now(UTC),
                },
                "change_type": "ADDED",
            }
        )
        # The generator subscribes a SEPARATE queue — push the event onto
        # every queue the hub holds for `g1` so it lands on the generator's
        # own queue too.
        gen = _stream_event_generator(fake_request, gid="g1", ctx=ctx)
        first = await gen.__anext__()
        assert first == b": connected\n\n"
        # Now re-broadcast so the generator's freshly-subscribed queue gets
        # the event.
        with hub._lock:
            queues = list(hub._groups["g1"].subscribers)
        for q in queues:
            await q.put(
                {
                    "id": "m42",
                    "data": {
                        "authorUid": "bob",
                        "body": "hello world",
                        "createdAt": datetime.now(UTC).isoformat(),
                    },
                    "change_type": "ADDED",
                }
            )
        # Pull the message frame.
        second = await gen.__anext__()
        assert second.startswith(b"event: message\ndata: ")
        assert b'"id":"m42"' in second
        assert b'"body":"hello world"' in second
        # Drain through to the disconnect-true exit.
        try:
            await asyncio.wait_for(gen.__anext__(), timeout=0.1)
        except (TimeoutError, StopAsyncIteration):
            pass


# ── StreamHub unit tests ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_hub_subscribe_attaches_listener_once_per_group() -> None:
    """First subscribe attaches a listener; second subscribe to the same
    group reuses it; the listener is detached when the last subscriber
    unsubscribes."""
    hub = StreamHub()
    attached: list[str] = []
    detached: list[str] = []

    def fake_attach(self: StreamHub, gid: str) -> None:
        attached.append(gid)
        watch = MagicMock()

        def _unsub() -> None:
            detached.append(gid)

        watch.unsubscribe = _unsub
        with self._lock:
            state = self._groups.get(gid)
            if state is not None:
                state.watch = watch

    with patch.object(StreamHub, "_attach_listener", fake_attach):
        q1 = await hub.subscribe("g1")
        q2 = await hub.subscribe("g1")
        assert attached == ["g1"], "second subscriber should reuse the listener"

        await hub.unsubscribe("g1", q1)
        assert detached == [], "listener stays attached while another subscriber holds it"

        await hub.unsubscribe("g1", q2)
        assert detached == ["g1"], "listener detaches when last subscriber leaves"


@pytest.mark.asyncio
async def test_hub_broadcasts_added_changes_to_every_subscriber() -> None:
    """An ADDED change pushed by the listener thread reaches each queue."""
    hub = StreamHub()
    with patch.object(StreamHub, "_attach_listener", lambda self, gid: None):
        q1 = await hub.subscribe("g1")
        q2 = await hub.subscribe("g1")

        change = MagicMock()
        change.type.name = "ADDED"
        change.document.id = "m1"
        change.document.to_dict.return_value = {
            "authorUid": "bob",
            "body": "hi",
            "createdAt": datetime.now(UTC),
        }
        # The listener callback is invoked from a Firestore thread, so the
        # broadcast hops via `run_coroutine_threadsafe`. Calling it from
        # the event-loop thread works because the loop is the running one;
        # the scheduling overhead is the same.
        hub._on_snapshot("g1", MagicMock(), [change], MagicMock())

        ev1 = await asyncio.wait_for(q1.get(), timeout=1.0)
        ev2 = await asyncio.wait_for(q2.get(), timeout=1.0)
        assert ev1["id"] == "m1"
        assert ev1["change_type"] == "ADDED"
        assert ev2["id"] == "m1"


@pytest.mark.asyncio
async def test_hub_ignores_removed_changes() -> None:
    """REMOVED changes are hard-deletes; M4 uses soft-delete so we don't
    push REMOVED to clients."""
    hub = StreamHub()
    with patch.object(StreamHub, "_attach_listener", lambda self, gid: None):
        q = await hub.subscribe("g1")
        change = MagicMock()
        change.type.name = "REMOVED"
        change.document.id = "m1"
        change.document.to_dict.return_value = {"body": "x"}
        hub._on_snapshot("g1", MagicMock(), [change], MagicMock())
        # The event loop needs a chance to run the schedule (if any); but
        # since REMOVED is filtered, no schedule should land at all.
        await asyncio.sleep(0.01)
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(q.get(), timeout=0.1)


@pytest.mark.asyncio
async def test_hub_broadcasts_modified_changes() -> None:
    """MODIFIED is how soft-deletes and edits surface — also pushed."""
    hub = StreamHub()
    with patch.object(StreamHub, "_attach_listener", lambda self, gid: None):
        q = await hub.subscribe("g1")
        change = MagicMock()
        change.type.name = "MODIFIED"
        change.document.id = "m1"
        change.document.to_dict.return_value = {
            "authorUid": "bob",
            "body": "edited",
            "createdAt": datetime.now(UTC),
            "editedAt": datetime.now(UTC),
        }
        hub._on_snapshot("g1", MagicMock(), [change], MagicMock())
        ev = await asyncio.wait_for(q.get(), timeout=1.0)
        assert ev["change_type"] == "MODIFIED"


@pytest.mark.asyncio
async def test_hub_shutdown_detaches_every_listener() -> None:
    hub = StreamHub()
    detached: list[str] = []

    def fake_attach(self: StreamHub, gid: str) -> None:
        watch = MagicMock()
        watch.unsubscribe = lambda gid=gid: detached.append(gid)
        with self._lock:
            state = self._groups.get(gid)
            if state is not None:
                state.watch = watch

    with patch.object(StreamHub, "_attach_listener", fake_attach):
        await hub.subscribe("g1")
        await hub.subscribe("g2")
        await hub.shutdown()
    assert sorted(detached) == ["g1", "g2"]


@pytest.mark.asyncio
async def test_hub_unsubscribe_handles_unknown_queue() -> None:
    """A second unsubscribe on the same queue is a no-op (idempotent)."""
    hub = StreamHub()
    with patch.object(StreamHub, "_attach_listener", lambda self, gid: None):
        q = await hub.subscribe("g1")
        await hub.unsubscribe("g1", q)
        # Should not raise.
        await hub.unsubscribe("g1", q)


@pytest.mark.asyncio
async def test_hub_drops_events_on_full_queue() -> None:
    """A slow consumer can't pin unbounded memory in the listener thread."""
    hub = StreamHub()
    with patch.object(StreamHub, "_attach_listener", lambda self, gid: None):
        # The queue handle isn't drained — the test deliberately fills it
        # past capacity so the next put_nowait raises QueueFull.
        await hub.subscribe("g1")
        # Fill the queue past its bounded capacity.
        from app.services.stream_hub import _QUEUE_MAXSIZE

        for i in range(_QUEUE_MAXSIZE + 5):
            change = MagicMock()
            change.type.name = "ADDED"
            change.document.id = f"m{i}"
            change.document.to_dict.return_value = {"body": f"m{i}"}
            hub._on_snapshot("g1", MagicMock(), [change], MagicMock())
            # Yield control so the broadcast can run.
            await asyncio.sleep(0)
        with hub._lock:
            dropped = hub._groups["g1"].dropped_events
        assert dropped >= 1, "expected the slow consumer to drop overflow events"
