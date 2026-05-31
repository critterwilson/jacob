"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

type Status = "pending" | "approved" | "rejected";
type Audience = "christian" | "bjj" | "general";

type LeaderApplication = {
  appId: string;
  applicantUid: string;
  applicantDisplayName: string;
  applicantEmail: string | null;
  proposedGroupName: string;
  proposedGroupDescription: string;
  proposedAudience: Audience;
  motivation: string;
  status: Status;
  createdAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNotes: string;
  createdGroupId: string | null;
};

type ListResponse = {
  items: LeaderApplication[];
  nextCursor: string | null;
};

const PAGE_SIZE = 25;
const STATUSES: Status[] = ["pending", "approved", "rejected"];

function isStatus(v: string | null): v is Status {
  return v === "pending" || v === "approved" || v === "rejected";
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

function formatDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
}

/**
 * Owner queue for the ADR 0015 leader-application flow.
 *
 * Lists pending applications; approve writes the target group + makes
 * the applicant its leader; reject records a reason for the audit log.
 */
export default function LeaderApplicationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status: Status = isStatus(searchParams.get("status"))
    ? (searchParams.get("status") as Status)
    : "pending";

  const [items, setItems] = useState<LeaderApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [audienceOverride, setAudienceOverride] = useState<
    Record<string, Audience | "">
  >({});
  const [reason, setReason] = useState<Record<string, string>>({});

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("status", status);
    p.set("limit", String(PAGE_SIZE));
    return p.toString();
  }, [status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ListResponse>(
        `/api/admin/leader-applications?${queryString}`,
      );
      setItems(data.items);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(errMsg(e, "Failed to load leader applications"));
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = useCallback(
    (next: Status) => {
      const p = new URLSearchParams(searchParams.toString());
      if (next === "pending") {
        p.delete("status");
      } else {
        p.set("status", next);
      }
      router.replace(
        `/admin/leader-applications${p.toString() ? `?${p.toString()}` : ""}`,
      );
    },
    [router, searchParams],
  );

  const approve = useCallback(
    async (item: LeaderApplication) => {
      setBusy((s) => ({ ...s, [item.appId]: true }));
      try {
        const ov = audienceOverride[item.appId];
        const body: { decisionNotes: string; audienceOverride?: Audience } = {
          decisionNotes: notes[item.appId] ?? "",
        };
        if (ov === "christian" || ov === "bjj" || ov === "general") {
          body.audienceOverride = ov;
        }
        await apiPost(
          `/api/admin/leader-applications/${item.appId}/approve`,
          body,
        );
        await load();
      } catch (e) {
        setError(errMsg(e, "Approve failed"));
      } finally {
        setBusy((s) => ({ ...s, [item.appId]: false }));
      }
    },
    [audienceOverride, load, notes],
  );

  const reject = useCallback(
    async (item: LeaderApplication) => {
      const r = (reason[item.appId] ?? "").trim();
      if (!r) {
        setError("A rejection reason is required");
        return;
      }
      setBusy((s) => ({ ...s, [item.appId]: true }));
      try {
        await apiPost(`/api/admin/leader-applications/${item.appId}/reject`, {
          reason: r,
        });
        await load();
      } catch (e) {
        setError(errMsg(e, "Reject failed"));
      } finally {
        setBusy((s) => ({ ...s, [item.appId]: false }));
      }
    },
    [load, reason],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="space-y-2">
        <Eyebrow>Owner queue</Eyebrow>
        <Heading level={1} size="md">
          Leader applications
        </Heading>
        <p className="text-body-sm text-cream-muted">
          Pending applications from users who want to lead a new group. Approve
          to create the group with the applicant as its leader. Reject to send
          them a reason.
        </p>
      </header>

      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <Button
            key={s}
            type="button"
            variant={s === status ? "primary" : "secondary"}
            size="sm"
            onClick={() => setStatus(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-body-sm text-cream-muted">
          No {status} applications.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.appId}>
              <Card surface="raised" padding="lg" className="space-y-4">
                <header className="flex flex-col gap-1">
                  <Heading level={2} size="sm">
                    {item.proposedGroupName}
                  </Heading>
                  <p className="text-body-sm text-cream-muted">
                    Applicant:{" "}
                    <span className="text-cream">
                      {item.applicantDisplayName || item.applicantUid}
                    </span>{" "}
                    {item.applicantEmail && <>· {item.applicantEmail}</>} ·
                    audience{" "}
                    <span className="text-cream">{item.proposedAudience}</span>{" "}
                    · submitted {formatDate(item.createdAt)}
                  </p>
                </header>
                <p className="text-body-sm text-cream">
                  {item.proposedGroupDescription}
                </p>
                {item.motivation && (
                  <p className="text-body-sm text-cream-muted">
                    <strong className="text-cream">Motivation: </strong>
                    {item.motivation}
                  </p>
                )}

                {item.status === "pending" && (
                  <div className="space-y-4 border-t border-line pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-body-sm">
                        <span className="text-cream">Audience override</span>
                        <select
                          className="block w-full rounded border border-line bg-ink px-3 py-2 text-body text-cream"
                          value={audienceOverride[item.appId] ?? ""}
                          onChange={(e) =>
                            setAudienceOverride((s) => ({
                              ...s,
                              [item.appId]: e.target.value as Audience | "",
                            }))
                          }
                        >
                          <option value="">
                            (keep {item.proposedAudience})
                          </option>
                          <option value="christian">christian</option>
                          <option value="general">general</option>
                        </select>
                      </label>
                      <Input
                        label="Approval notes (optional)"
                        value={notes[item.appId] ?? ""}
                        onChange={(e) =>
                          setNotes((s) => ({
                            ...s,
                            [item.appId]: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void approve(item)}
                      loading={!!busy[item.appId]}
                    >
                      Approve + create group
                    </Button>

                    <div className="space-y-2 border-t border-line pt-4">
                      <Textarea
                        label="Rejection reason (required)"
                        rows={2}
                        value={reason[item.appId] ?? ""}
                        onChange={(e) =>
                          setReason((s) => ({
                            ...s,
                            [item.appId]: e.target.value,
                          }))
                        }
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void reject(item)}
                        loading={!!busy[item.appId]}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}

                {item.status === "approved" && item.createdGroupId && (
                  <p className="text-body-sm text-cream-muted">
                    Approved on {formatDate(item.decidedAt)}; created group{" "}
                    <code className="text-cream">{item.createdGroupId}</code>.
                  </p>
                )}
                {item.status === "rejected" && (
                  <p className="text-body-sm text-cream-muted">
                    Rejected on {formatDate(item.decidedAt)}.
                    {item.decisionNotes && (
                      <>
                        {" "}
                        <span className="text-cream">{item.decisionNotes}</span>
                      </>
                    )}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <p className="text-body-sm text-cream-muted">
          More results available. Pagination is not yet wired in this view —
          drain the queue by deciding pending items.
        </p>
      )}
    </div>
  );
}
