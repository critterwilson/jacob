"""SSE fan-out hub for the chat stream (M5 / ADR 0013).

Each Cloud Run instance has at most one Firestore listener per active
group, regardless of how many SSE subscribers are connected for that
group. Subscribers receive events via per-connection `asyncio.Queue`s;
the listener thread (managed by `firebase_admin`) hands change events
to the event loop with `run_coroutine_threadsafe`.

Lifecycle:

* `subscribe(gid)` returns a queue and (lazily) attaches the listener.
* `unsubscribe(gid, queue)` removes the queue and, if it was the last
  one for that group, detaches the listener so the next idle period
  costs no Firestore reads.
* `shutdown()` is called from the FastAPI lifespan on revision rotation
  so listeners terminate cleanly instead of getting `SIGTERM`'d
  mid-stream.

The `start_time` filter (`createdAt >= attach_time`) is the load-bearing
choice that lets us skip the initial-snapshot replay: a listener attached
with this filter fires once with an empty result set, then fires only
for documents written after attach. See ADR 0013 § 4 for the trade-off
(edits to old messages don't push; polling fallback handles them).
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.services.firebase import get_firestore

logger = logging.getLogger(__name__)


# Per-queue cap. A pathologically slow consumer can't be allowed to
# pin unbounded memory in the listener thread's hand-off. Hitting the
# cap drops the oldest event and increments a counter; the client
# catches up via the polling fallback after the next reconnect.
_QUEUE_MAXSIZE = 256


@dataclass
class _GroupState:
    subscribers: set[asyncio.Queue[dict[str, Any]]] = field(default_factory=set)
    watch: Any = None  # firebase_admin.firestore Watch handle
    attached_at: datetime | None = None
    dropped_events: int = 0


class StreamHub:
    """Per-process SSE fan-out coordinator."""

    def __init__(self) -> None:
        # Both threads need this lock: subscribe/unsubscribe runs in the
        # event loop, _on_snapshot runs in a firestore listener thread.
        self._lock = threading.Lock()
        self._groups: dict[str, _GroupState] = {}
        # Captured on first subscribe so the listener thread can schedule
        # broadcasts back onto the event loop.
        self._loop: asyncio.AbstractEventLoop | None = None
        # Flips on shutdown so straggler events from a still-detaching
        # listener don't try to schedule onto a closing loop.
        self._closed = False

    # ── public API (called from the event loop) ──────────────────────────

    async def subscribe(self, gid: str) -> asyncio.Queue[dict[str, Any]]:
        """Add a subscriber for `gid` and lazily attach the Firestore listener.

        Returns a queue the caller drains in its SSE event-generator. The
        caller MUST call `unsubscribe(gid, queue)` in its finally-block;
        otherwise the listener won't tear down when the last viewer leaves.
        """
        if self._closed:
            raise RuntimeError("StreamHub is shut down")
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        loop = asyncio.get_running_loop()
        with self._lock:
            if self._loop is None:
                self._loop = loop
            state = self._groups.get(gid)
            if state is None:
                state = _GroupState()
                self._groups[gid] = state
            state.subscribers.add(queue)
            needs_listener = state.watch is None
            if needs_listener:
                # Capture attach_time before we hand control to the SDK so
                # any race that lands a write between now and the watch
                # callback firing is still picked up by the filter.
                state.attached_at = datetime.now(UTC)
        if needs_listener:
            self._attach_listener(gid)
        logger.info("stream_subscribed gid=%s subscribers=%d", gid, len(state.subscribers))
        return queue

    async def unsubscribe(self, gid: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Remove a subscriber. Detaches the listener if it was the last one."""
        detach_watch: Any = None
        remaining = 0
        with self._lock:
            state = self._groups.get(gid)
            if state is None:
                return
            state.subscribers.discard(queue)
            remaining = len(state.subscribers)
            if remaining == 0:
                detach_watch = state.watch
                self._groups.pop(gid, None)
        if detach_watch is not None:
            try:
                detach_watch.unsubscribe()
            except Exception:  # noqa: BLE001
                logger.exception("stream_listener_detach_failed gid=%s", gid)
        logger.info("stream_unsubscribed gid=%s remaining=%d", gid, remaining)

    async def shutdown(self) -> None:
        """Detach every listener. Called from FastAPI lifespan on shutdown."""
        with self._lock:
            self._closed = True
            states = list(self._groups.values())
            self._groups.clear()
        for state in states:
            watch = state.watch
            if watch is None:
                continue
            try:
                watch.unsubscribe()
            except Exception:  # noqa: BLE001
                logger.exception("stream_listener_shutdown_unsubscribe_failed")
        logger.info("stream_hub_shutdown listeners_detached=%d", len(states))

    # ── listener wiring (Admin SDK threads) ──────────────────────────────

    def _attach_listener(self, gid: str) -> None:
        """Attach a Firestore listener for `groups/{gid}/messages`.

        The listener filter is `createdAt >= attach_time` so the initial
        snapshot is empty and only post-attach writes flow through. See
        ADR 0013 § 4.
        """
        try:
            db = get_firestore()
            with self._lock:
                state = self._groups.get(gid)
                if state is None or state.attached_at is None:
                    # Subscriber raced unsubscribe; nothing to do.
                    return
                attach_time = state.attached_at
            col = db.collection("groups").document(gid).collection("messages")
            query = col.where("createdAt", ">=", attach_time)
            watch = query.on_snapshot(
                lambda snap, changes, read_time: self._on_snapshot(gid, snap, changes, read_time)
            )
            with self._lock:
                state = self._groups.get(gid)
                if state is None:
                    # Subscribers all left between attach and now.
                    try:
                        watch.unsubscribe()
                    except Exception:  # noqa: BLE001
                        pass
                    return
                state.watch = watch
            logger.info("stream_listener_attached gid=%s attached_at=%s", gid, attach_time)
        except Exception:  # noqa: BLE001
            logger.exception("stream_listener_attach_failed gid=%s", gid)
            # Clear the group so a future subscriber retries from scratch
            # rather than getting stuck on a half-attached state.
            with self._lock:
                self._groups.pop(gid, None)

    def _on_snapshot(
        self,
        gid: str,
        snapshot: Any,
        changes: Any,
        read_time: Any,
    ) -> None:
        """Firestore listener callback. Runs in an Admin SDK thread.

        Builds an event per ADDED / MODIFIED change and hops back onto
        the event loop via `run_coroutine_threadsafe`. REMOVED changes
        are ignored — soft-delete is the M4 semantics (`deletedAt` is
        set, doc still exists), so a REMOVED change is a hard-delete and
        we don't need to push that to clients.
        """
        if self._closed:
            return
        loop = self._loop
        if loop is None:
            return
        events: list[dict[str, Any]] = []
        for change in changes or []:
            change_type = getattr(getattr(change, "type", None), "name", "")
            if change_type not in ("ADDED", "MODIFIED"):
                continue
            doc = getattr(change, "document", None)
            if doc is None:
                continue
            try:
                data = doc.to_dict() or {}
            except Exception:  # noqa: BLE001
                logger.exception("stream_doc_to_dict_failed gid=%s", gid)
                continue
            events.append({"id": getattr(doc, "id", ""), "data": data, "change_type": change_type})
        if not events:
            return
        # Schedule onto the event loop. `run_coroutine_threadsafe` is
        # exactly the bridge we want — it returns a future we don't need
        # to await because broadcasts are fire-and-forget.
        try:
            asyncio.run_coroutine_threadsafe(self._broadcast(gid, events), loop)
        except RuntimeError:
            # Loop was closed between the closed-check and the schedule.
            logger.warning("stream_broadcast_loop_closed gid=%s events=%d", gid, len(events))

    async def _broadcast(self, gid: str, events: list[dict[str, Any]]) -> None:
        """Push each event onto every subscriber queue for `gid`."""
        with self._lock:
            state = self._groups.get(gid)
            if state is None:
                return
            subs = list(state.subscribers)
        for ev in events:
            for q in subs:
                try:
                    q.put_nowait(ev)
                except asyncio.QueueFull:
                    with self._lock:
                        st = self._groups.get(gid)
                        if st is not None:
                            st.dropped_events += 1
                    logger.warning("stream_queue_full gid=%s dropping_event", gid)


# Module-level singleton. The router holds a reference; the lifespan
# hook in `app.main` drives `shutdown()`.
_hub: StreamHub | None = None
_singleton_lock = threading.Lock()


def get_stream_hub() -> StreamHub:
    global _hub
    if _hub is None:
        with _singleton_lock:
            if _hub is None:
                _hub = StreamHub()
    return _hub


def reset_stream_hub_for_tests() -> None:
    """Replace the singleton with a fresh hub. Tests only."""
    global _hub
    with _singleton_lock:
        _hub = StreamHub()
