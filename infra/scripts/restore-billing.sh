#!/usr/bin/env bash
#
# restore-billing.sh — re-enable billing after the $10/mo kill switch fired
# (or after a false trigger). Re-links the billing account that
# billing-killswitch.tf / the kill-switch function unlinked.
#
# The kill switch only UNLINKS billing — it never deletes data. Re-linking
# brings every service back exactly as it was.
#
# Usage:
#   ./infra/scripts/restore-billing.sh                 # staging, default account
#   ./infra/scripts/restore-billing.sh <project-id> <billing-account-id>
#
# Defaults match the JACOB staging project + the "jacob" billing account.
#
# After running, investigate WHY the cap was hit (see docs/runbooks/cost-control.md)
# before traffic resumes — otherwise it will just trip again.

set -euo pipefail

PROJECT_ID="${1:-jacob-staging-494515}"
BILLING_ACCOUNT="${2:-011F58-EB11C1-9D0B34}"

echo "Re-linking billing account ${BILLING_ACCOUNT} → project ${PROJECT_ID} ..."
gcloud billing projects link "${PROJECT_ID}" \
  --billing-account="${BILLING_ACCOUNT}"

echo
echo "Done. Verify:"
gcloud billing projects describe "${PROJECT_ID}" \
  --format="value(billingEnabled)"
echo
echo "If this was a real cap breach, find the cause before it re-trips:"
echo "  https://console.cloud.google.com/billing/${BILLING_ACCOUNT}/reports?project=${PROJECT_ID}"
