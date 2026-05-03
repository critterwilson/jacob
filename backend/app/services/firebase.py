"""Firebase Admin SDK singleton.

Initialised lazily with Application Default Credentials. The Admin SDK
honours `FIREBASE_AUTH_EMULATOR_HOST` automatically when set, so local
emulator usage requires no code changes.
"""

from __future__ import annotations

import threading
from typing import Any

import firebase_admin

_lock = threading.Lock()


def get_firestore() -> Any:
    """Return the Firestore Admin client, initialising Firebase if necessary."""
    init_firebase_admin()
    from firebase_admin import firestore as admin_firestore  # noqa: PLC0415

    return admin_firestore.client()


def init_firebase_admin() -> firebase_admin.App:
    try:
        return firebase_admin.get_app()
    except ValueError:
        with _lock:
            try:
                return firebase_admin.get_app()
            except ValueError:
                return firebase_admin.initialize_app()
