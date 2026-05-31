"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Banner,
  Button,
  Card,
  Eyebrow,
  Heading,
  Input,
  Textarea,
} from "@/components/ui";
import { ApiError, apiGet, apiPost } from "@/lib/api";

type MinorJoinRequest = {
  gid: string;
  groupName: string;
  uid: string;
  displayName: string;
  photoURL: string | null;
  age: number | null;
  message: string;
  requestedAt: string;
  inviteCode: string | null;
  // Two-step minor approval: who vouched (a group leader) and when. The
  // request only reaches this owner queue after a leader has vouched.
  leaderVouchedByUid: string | null;
  leaderVouchedByName: string;
  leaderVouchedAt: string | null;
};

type ListResponse = {
  requests: MinorJoinRequest[];
  nextCursor: string | null;
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

function formatDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}

/**
 * Owner queue for minor join-requests (ADR 0015 § 4).
 *
 * Group leaders cannot see or action these — the backend strips them
 * from the leader's list and refuses leader-side approve/reject. The
 * owner attests parental consent here and either approves (the
 * applicant becomes a group member; any persisted invite is consumed
 * at this moment) or rejects with a reason.
 */
export default function MinorReviewsPage() {
  const [items, setItems] = useState<MinorJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [consentNotes, setConsentNotes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ListResponse>(
        "/api/admin/minor-join-requests?limit=25",
      );
      setItems(data.requests);
    } catch (e) {
      setError(errMsg(e, "Failed to load minor join requests"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const key = (r: MinorJoinRequest) => `${r.gid}:${r.uid}`;

  const approve = useCallback(
    async (item: MinorJoinRequest) => {
      const k = key(item);
      if (!consent[k]) {
        setError(
          "Tick the parental-consent box before approving a minor's request",
        );
        return;
      }
      setBusy((s) => ({ ...s, [k]: true }));
      try {
        await apiPost(
          `/api/admin/groups/${item.gid}/join-requests/${item.uid}/approve`,
          {
            parentalConsentObtained: true,
            parentalConsentNotes: consentNotes[k] ?? "",
          },
        );
        await load();
      } catch (e) {
        setError(errMsg(e, "Approve failed"));
      } finally {
        setBusy((s) => ({ ...s, [k]: false }));
      }
    },
    [consent, consentNotes, load],
  );

  const reject = useCallback(
    async (item: MinorJoinRequest) => {
      const k = key(item);
      const r = (reason[k] ?? "").trim();
      if (!r) {
        setError("A rejection reason is required");
        return;
      }
      setBusy((s) => ({ ...s, [k]: true }));
      try {
        await apiPost(
          `/api/admin/groups/${item.gid}/join-requests/${item.uid}/reject`,
          { reason: r },
        );
        await load();
      } catch (e) {
        setError(errMsg(e, "Reject failed"));
      } finally {
        setBusy((s) => ({ ...s, [k]: false }));
      }
    },
    [load, reason],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="space-y-2">
        <Eyebrow>Owner queue · minors</Eyebrow>
        <Heading level={1} size="md">
          Minor join requests
        </Heading>
        <p className="text-body-sm text-cream-muted">
          Under-18 applicants a group leader has already vouched for. Both
          steps are required: the leader vouches first, then you confirm
          parental consent here before the applicant becomes a member.
        </p>
      </header>

      {error && <Banner tone="error">{error}</Banner>}

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-body-sm text-cream-muted">
          No pending minor join requests.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const k = key(item);
            return (
              <li key={k}>
                <Card surface="raised" padding="lg" className="space-y-4">
                  <header className="space-y-1">
                    <Heading level={2} size="sm">
                      {item.displayName || item.uid}
                    </Heading>
                    <p className="text-body-sm text-cream-muted">
                      Wants to join{" "}
                      <span className="text-cream">{item.groupName}</span>{" "}
                      <code className="text-cream-muted">({item.gid})</code> ·
                      requested {formatDate(item.requestedAt)}
                      {item.inviteCode && (
                        <>
                          {" "}
                          · via invite{" "}
                          <code className="text-cream">{item.inviteCode}</code>
                        </>
                      )}
                    </p>
                    <p
                      data-testid={`leader-vouch-${item.uid}`}
                      className="text-body-sm font-medium text-sage"
                    >
                      Leader-vouched: yes
                      {item.leaderVouchedByName
                        ? `, by ${item.leaderVouchedByName}`
                        : ""}
                      {item.leaderVouchedAt
                        ? ` on ${formatDate(item.leaderVouchedAt)}`
                        : ""}
                    </p>
                  </header>
                  {item.message && (
                    <p className="text-body-sm text-cream">{item.message}</p>
                  )}

                  <div className="space-y-3 border-t border-line pt-4">
                    <label className="flex items-start gap-3 text-body-sm text-cream">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 accent-gold"
                        checked={!!consent[k]}
                        onChange={(e) =>
                          setConsent((s) => ({ ...s, [k]: e.target.checked }))
                        }
                      />
                      <span>
                        I confirm a parent or guardian has given consent for
                        this minor to participate.
                      </span>
                    </label>
                    <Input
                      label="Notes on how consent was obtained (optional)"
                      value={consentNotes[k] ?? ""}
                      onChange={(e) =>
                        setConsentNotes((s) => ({
                          ...s,
                          [k]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void approve(item)}
                      loading={!!busy[k]}
                    >
                      Approve into group
                    </Button>

                    <div className="space-y-2 border-t border-line pt-4">
                      <Textarea
                        label="Rejection reason (required)"
                        rows={2}
                        value={reason[k] ?? ""}
                        onChange={(e) =>
                          setReason((s) => ({ ...s, [k]: e.target.value }))
                        }
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void reject(item)}
                        loading={!!busy[k]}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
