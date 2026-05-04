"""Feature-flag CLI for incident response (T58).

When the admin UI is unavailable, an on-call engineer with backend access
can flip a flag from the terminal. Always writes an `audit_log` row with
`actorUid = "cli:<sub>"` so off-band changes stay traceable.

Usage:
    cd backend
    python scripts/flag.py list
    python scripts/flag.py get <flagKey>
    python scripts/flag.py set <flagKey> --enabled true --pct 25
    python scripts/flag.py percent <flagKey> 50
    python scripts/flag.py disable <flagKey>
    python scripts/flag.py delete <flagKey>

Use `--actor <id>` to attribute the action (defaults to the local username).
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _actor(args: argparse.Namespace) -> str:
    return f"cli:{args.actor or getpass.getuser()}"


def _doc_to_dict(snap: Any) -> dict[str, Any]:
    data = snap.to_dict() or {}
    out: dict[str, Any] = {"flagKey": snap.id}
    for key in ("enabled", "rolloutPercentage", "cohorts", "description"):
        if key in data:
            out[key] = data[key]
    return out


def cmd_list(args: argparse.Namespace) -> int:
    db = _db()
    rows = []
    for snap in db.collection("feature_flags").order_by("__name__").stream():
        rows.append(_doc_to_dict(snap))
    print(json.dumps(rows, indent=2, default=str))
    return 0


def cmd_get(args: argparse.Namespace) -> int:
    db = _db()
    snap = db.collection("feature_flags").document(args.flag_key).get()
    if not snap.exists:
        print(f"flag {args.flag_key!r} not found", file=sys.stderr)
        return 1
    print(json.dumps(_doc_to_dict(snap), indent=2, default=str))
    return 0


def _set_flag(
    *,
    flag_key: str,
    enabled: bool,
    pct: int,
    actor: str,
) -> None:
    db = _db()
    ref = db.collection("feature_flags").document(flag_key)
    existing_snap = ref.get()
    existing = existing_snap.to_dict() if existing_snap.exists else {}
    existing_full_at = (existing or {}).get("fullRolloutAt")

    full_rollout_at: Any
    if pct >= 100:
        full_rollout_at = existing_full_at or fb_firestore.SERVER_TIMESTAMP
    else:
        full_rollout_at = None

    cohorts = (existing or {}).get("cohorts") or {
        "orgIds": [],
        "roles": [],
        "uids": [],
    }
    payload = {
        "enabled": enabled,
        "rolloutPercentage": pct,
        "cohorts": cohorts,
        "description": (existing or {}).get("description", ""),
        "updatedBy": actor,
        "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        "fullRolloutAt": full_rollout_at,
        "schemaVersion": 1,
    }
    ref.set(payload, merge=False)
    write_audit_log(
        actor_uid=actor,
        action="flag_update",
        target_ref=f"feature_flags/{flag_key}",
        payload={
            "enabled": enabled,
            "rolloutPercentage": pct,
            "via": "cli",
        },
    )
    print(f"set {flag_key} enabled={enabled} pct={pct} via=cli actor={actor}")


def cmd_set(args: argparse.Namespace) -> int:
    if args.enabled.lower() not in {"true", "false"}:
        print("--enabled must be true or false", file=sys.stderr)
        return 2
    pct = int(args.pct)
    if not 0 <= pct <= 100:
        print("--pct must be in [0,100]", file=sys.stderr)
        return 2
    _set_flag(
        flag_key=args.flag_key,
        enabled=args.enabled.lower() == "true",
        pct=pct,
        actor=_actor(args),
    )
    return 0


def cmd_percent(args: argparse.Namespace) -> int:
    db = _db()
    snap = db.collection("feature_flags").document(args.flag_key).get()
    if not snap.exists:
        print(f"flag {args.flag_key!r} not found", file=sys.stderr)
        return 1
    existing = snap.to_dict() or {}
    pct = int(args.pct)
    if not 0 <= pct <= 100:
        print("pct must be in [0,100]", file=sys.stderr)
        return 2
    _set_flag(
        flag_key=args.flag_key,
        enabled=bool(existing.get("enabled", False)),
        pct=pct,
        actor=_actor(args),
    )
    return 0


def cmd_disable(args: argparse.Namespace) -> int:
    db = _db()
    snap = db.collection("feature_flags").document(args.flag_key).get()
    if not snap.exists:
        print(f"flag {args.flag_key!r} not found", file=sys.stderr)
        return 1
    existing = snap.to_dict() or {}
    _set_flag(
        flag_key=args.flag_key,
        enabled=False,
        pct=int(existing.get("rolloutPercentage", 0) or 0),
        actor=_actor(args),
    )
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    db = _db()
    ref = db.collection("feature_flags").document(args.flag_key)
    snap = ref.get()
    if not snap.exists:
        print(f"flag {args.flag_key!r} not found (nothing to do)")
        return 0
    ref.delete()
    actor = _actor(args)
    write_audit_log(
        actor_uid=actor,
        action="flag_delete",
        target_ref=f"feature_flags/{args.flag_key}",
        payload={"via": "cli"},
    )
    print(f"deleted {args.flag_key} actor={actor}")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actor", default=None, help="actor id for audit log")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list every flag").set_defaults(func=cmd_list)

    g = sub.add_parser("get", help="show one flag")
    g.add_argument("flag_key")
    g.set_defaults(func=cmd_get)

    s = sub.add_parser("set", help="upsert a flag")
    s.add_argument("flag_key")
    s.add_argument("--enabled", required=True)
    s.add_argument("--pct", required=True)
    s.set_defaults(func=cmd_set)

    p = sub.add_parser("percent", help="just change the percentage")
    p.add_argument("flag_key")
    p.add_argument("pct")
    p.set_defaults(func=cmd_percent)

    d = sub.add_parser("disable", help="set enabled=false (preserve pct)")
    d.add_argument("flag_key")
    d.set_defaults(func=cmd_disable)

    rm = sub.add_parser("delete", help="remove the flag entirely")
    rm.add_argument("flag_key")
    rm.set_defaults(func=cmd_delete)

    args = parser.parse_args(argv[1:])
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
