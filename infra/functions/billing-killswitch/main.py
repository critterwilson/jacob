"""Budget kill switch — disables billing on the project when actual spend
reaches the $10/mo cap.

This is the canonical Google "panic button" pattern: a Cloud Billing budget
publishes threshold notifications to a Pub/Sub topic; this gen2 Cloud Function
subscribes to that topic and, once *actual* (not forecast) spend meets or
exceeds the budget amount, calls
``cloudbilling.projects.updateBillingInfo({billingAccountName: ""})`` to unlink
the billing account from the project. With no billing account, every billable
GCP service stops serving — but **no data is deleted**. Recovery is a single
re-link (see ``infra/scripts/restore-billing.sh``).

Behaviour notes:

* Only *actual* spend triggers the disable. Budgets also publish FORECAST
  threshold crossings (``costAmount`` below ``budgetAmount`` but trending over);
  those are ignored here and surface only as email alerts.
* Idempotent: if billing is already disabled on a project, it is skipped.
* ``KILLSWITCH_DRY_RUN=true`` logs the intended action without unlinking — use
  it to validate the wiring end to end without taking the project offline.
* ``KILLSWITCH_PROJECT_IDS`` is a comma-separated list. It defaults to the
  staging project only (prod is dormant). Add a project here *and* grant this
  function's service account ``roles/billing.projectManager`` on it to extend
  the cap.
"""

from __future__ import annotations

import base64
import json
import logging
import os

import functions_framework
import google.auth
from googleapiclient import discovery

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("billing-killswitch")

_PROJECT_IDS = [
    p.strip()
    for p in os.environ.get("KILLSWITCH_PROJECT_IDS", "").split(",")
    if p.strip()
]
_DRY_RUN = os.environ.get("KILLSWITCH_DRY_RUN", "false").lower() == "true"


def _billing_client():
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    # cache_discovery=False — the function instance is short-lived and the
    # on-disk discovery cache warning is noise in Cloud Logging.
    return discovery.build("cloudbilling", "v1", credentials=credentials,
                           cache_discovery=False)


def _disable_billing(billing, project_id: str) -> None:
    name = f"projects/{project_id}"
    info = billing.projects().getBillingInfo(name=name).execute()
    if not info.get("billingEnabled", False):
        logger.info("billing already disabled on %s — nothing to do", project_id)
        return
    if _DRY_RUN:
        logger.warning("[DRY_RUN] would unlink billing from %s", project_id)
        return
    billing.projects().updateBillingInfo(
        name=name, body={"billingAccountName": ""}
    ).execute()
    logger.critical(
        "BILLING DISABLED on %s — spend cap reached. Re-enable with "
        "infra/scripts/restore-billing.sh once the cause is understood.",
        project_id,
    )


@functions_framework.cloud_event
def stop_billing(cloud_event):
    """Entry point. Triggered by the budget's Pub/Sub notification."""
    try:
        encoded = cloud_event.data["message"]["data"]
    except (KeyError, TypeError):
        logger.error("malformed Pub/Sub envelope; ignoring: %s", cloud_event.data)
        return

    payload = json.loads(base64.b64decode(encoded).decode("utf-8"))
    cost = float(payload.get("costAmount", 0) or 0)
    budget = float(payload.get("budgetAmount", 0) or 0)
    name = payload.get("budgetDisplayName", "<unknown budget>")

    if budget <= 0:
        logger.error("budget amount missing/zero in notification; ignoring")
        return

    if cost < budget:
        logger.info(
            "'%s': actual spend %.2f below cap %.2f — alert only, no action",
            name, cost, budget,
        )
        return

    logger.warning(
        "'%s': actual spend %.2f >= cap %.2f — engaging kill switch on %s",
        name, cost, budget, _PROJECT_IDS,
    )
    if not _PROJECT_IDS:
        logger.error("KILLSWITCH_PROJECT_IDS empty — nothing to disable")
        return

    billing = _billing_client()
    for project_id in _PROJECT_IDS:
        try:
            _disable_billing(billing, project_id)
        except Exception:  # noqa: BLE001 — never let one project abort the rest
            logger.exception("failed to disable billing on %s", project_id)
