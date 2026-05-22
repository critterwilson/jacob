"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

type ApplicationStatus = "pending" | "approved" | "rejected";

type AdminApplication = {
  uid: string;
  email: string | null;
  displayName: string;
  photoURL: string | null;
  dob: string | null;
  age: number | null;
  isMinor: boolean;
  phone: string | null;
  location: string | null;
  faithBackground: string | null;
  status: ApplicationStatus;
  createdAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  parentalConsentObtained: boolean | null;
  parentalConsentNotes: string;
  rejectionReason: string;
  grandfathered: boolean;
};

type ListResponse = {
  items: AdminApplication[];
  nextCursor: string | null;
};

const PAGE_SIZE = 25;
const STATUSES: ApplicationStatus[] = ["pending", "approved", "rejected"];

function isStatus(v: string | null): v is ApplicationStatus {
  return v === "pending" || v === "approved" || v === "rejected";
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

export default function AdminApplicationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const status: ApplicationStatus = isStatus(searchParams.get("status"))
    ? (searchParams.get("status") as ApplicationStatus)
    : "pending";

  const [items, setItems] = useState<AdminApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, string>>({});

  // Inline approve/reject form state, keyed by application uid.
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [consentNotes, setConsentNotes] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("limit", String(PAGE_SIZE));
    return params.toString();
  }, [status]);

  const updateStatus = useCallback(
    (next: ApplicationStatus) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "pending") {
        params.delete("status");
      } else {
        params.set("status", next);
      }
      router.replace(
        `/admin/applications${params.toString() ? `?${params.toString()}` : ""}`,
      );
    },
    [router, searchParams],
  );

  const load = useCallback(
    async (cursor?: string) => {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const path = cursor
          ? `/api/admin/applications?${queryString}&cursor=${encodeURIComponent(cursor)}`
          : `/api/admin/applications?${queryString}`;
        const data = await apiGet<ListResponse>(path);
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor ?? null);
      } catch (e) {
        setError(errorMessage(e, "Failed to load applications"));
      } finally {
        setLoading(false);
      }
    },
    [user, queryString],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (app: AdminApplication) => {
    if (app.isMinor && !consent[app.uid]) {
      setActionState((s) => ({
        ...s,
        [app.uid]: "Parental consent must be confirmed before approving an under-18 applicant.",
      }));
      return;
    }
    setActionState((s) => ({ ...s, [app.uid]: "loading" }));
    try {
      await apiPost(`/api/admin/applications/${app.uid}/approve`, {
        parentalConsentObtained: app.isMinor ? Boolean(consent[app.uid]) : null,
        parentalConsentNotes: consentNotes[app.uid] ?? "",
      });
      setItems((prev) => prev.filter((i) => i.uid !== app.uid));
      setActionState((s) => ({ ...s, [app.uid]: "done" }));
    } catch (e) {
      setActionState((s) => ({ ...s, [app.uid]: errorMessage(e, "Approve failed") }));
    }
  };

  const reject = async (app: AdminApplication) => {
    const reason = rejectReason[app.uid] ?? "";
    if (!reason.trim()) {
      setActionState((s) => ({
        ...s,
        [app.uid]: "Add a rejection note so the applicant has context.",
      }));
      return;
    }
    setActionState((s) => ({ ...s, [app.uid]: "loading" }));
    try {
      await apiPost(`/api/admin/applications/${app.uid}/reject`, { reason });
      setItems((prev) => prev.filter((i) => i.uid !== app.uid));
      setActionState((s) => ({ ...s, [app.uid]: "done" }));
    } catch (e) {
      setActionState((s) => ({ ...s, [app.uid]: errorMessage(e, "Reject failed") }));
    }
  };

  if (loading && items.length === 0) {
    return (
      <p className="text-sm text-cream-muted">Loading applications…</p>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Signup Applications</h1>

      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="status-filter" className="text-sm text-cream-muted">
          Status
        </label>
        <select
          id="status-filter"
          className="rounded border border-line bg-ink-raised px-2 py-1 text-sm text-cream"
          value={status}
          onChange={(e) => updateStatus(e.target.value as ApplicationStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p
          className="mb-4 rounded border border-terracotta/40 bg-ink-raised p-3 text-sm text-terracotta"
          role="alert"
        >
          {error}
        </p>
      )}

      {items.length === 0 && !loading && (
        <p className="text-sm text-cream-muted">
          No {status} applications.
        </p>
      )}

      <ul className="space-y-4">
        {items.map((app) => {
          const isPending = app.status === "pending";
          const state = actionState[app.uid];
          return (
            <li
              key={app.uid}
              className="rounded border border-line bg-ink-raised p-4"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-base font-medium">
                    {app.displayName || "(no display name)"}
                  </p>
                  <p className="text-xs text-cream-muted">{app.email ?? "—"}</p>
                </div>
                <div className="flex flex-wrap items-baseline gap-3 text-xs text-cream-muted">
                  {app.age !== null && <span>Age {app.age}</span>}
                  {app.isMinor && (
                    <span className="rounded bg-terracotta/20 px-2 py-0.5 text-terracotta">
                      Under 18
                    </span>
                  )}
                  {app.grandfathered && (
                    <span className="rounded bg-gold/20 px-2 py-0.5 text-gold-soft">
                      Grandfathered
                    </span>
                  )}
                  <span>Submitted {formatDate(app.submittedAt)}</span>
                </div>
              </header>

              <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-cream-muted sm:grid-cols-3">
                {app.dob && (
                  <div>
                    <dt className="font-semibold">DOB</dt>
                    <dd>{app.dob}</dd>
                  </div>
                )}
                {app.location && (
                  <div>
                    <dt className="font-semibold">Location</dt>
                    <dd>{app.location}</dd>
                  </div>
                )}
                {app.phone && (
                  <div>
                    <dt className="font-semibold">Phone</dt>
                    <dd>{app.phone}</dd>
                  </div>
                )}
              </dl>

              {app.faithBackground && (
                <p className="mt-3 whitespace-pre-wrap text-sm text-cream">
                  {app.faithBackground}
                </p>
              )}

              {!isPending && (
                <p className="mt-3 text-xs text-cream-muted">
                  {app.status === "approved" ? "Approved" : "Rejected"}
                  {app.decidedBy ? ` by ${app.decidedBy}` : ""}
                  {app.decidedAt ? ` on ${formatDate(app.decidedAt)}` : ""}.
                  {app.parentalConsentObtained === true &&
                    " Parental consent recorded."}
                </p>
              )}
              {!isPending && app.parentalConsentNotes && (
                <p className="mt-1 text-xs text-cream-muted">
                  <span className="font-semibold">Consent notes:</span>{" "}
                  {app.parentalConsentNotes}
                </p>
              )}
              {!isPending && app.rejectionReason && (
                <p className="mt-1 text-xs text-cream-muted">
                  <span className="font-semibold">Reason:</span>{" "}
                  {app.rejectionReason}
                </p>
              )}

              {isPending && (
                <div className="mt-4 space-y-3 border-t border-line pt-3">
                  {app.isMinor && (
                    <div className="space-y-2 rounded border border-terracotta/40 bg-ink p-3">
                      <p className="text-xs font-semibold text-terracotta">
                        Under-18 applicant — parental consent required.
                      </p>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-cream">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-gold"
                          checked={Boolean(consent[app.uid])}
                          onChange={(e) =>
                            setConsent((c) => ({
                              ...c,
                              [app.uid]: e.target.checked,
                            }))
                          }
                        />
                        <span>
                          I confirm that parental or legal-guardian consent
                          has been obtained for this applicant.
                        </span>
                      </label>
                      <textarea
                        className="w-full rounded border border-line bg-ink p-2 text-sm text-cream"
                        rows={2}
                        placeholder="Notes (how consent was obtained — call, in-person, signed form, etc.)"
                        value={consentNotes[app.uid] ?? ""}
                        onChange={(e) =>
                          setConsentNotes((c) => ({
                            ...c,
                            [app.uid]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void approve(app)}
                      loading={state === "loading"}
                    >
                      Approve
                    </Button>
                    <input
                      type="text"
                      placeholder="Rejection reason"
                      className="flex-1 rounded border border-line bg-ink px-2 py-1 text-sm text-cream"
                      value={rejectReason[app.uid] ?? ""}
                      onChange={(e) =>
                        setRejectReason((r) => ({
                          ...r,
                          [app.uid]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void reject(app)}
                      loading={state === "loading"}
                    >
                      Reject
                    </Button>
                  </div>

                  {state && state !== "loading" && state !== "done" && (
                    <p className="text-sm text-terracotta" role="alert">
                      {state}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {nextCursor && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void load(nextCursor)}
            loading={loading}
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
