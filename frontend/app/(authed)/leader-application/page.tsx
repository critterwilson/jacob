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

type Audience = "christian" | "bjj" | "general";

type LeaderApplicationView = {
  appId: string;
  applicantUid: string;
  applicantDisplayName: string;
  applicantEmail: string | null;
  proposedGroupName: string;
  proposedGroupDescription: string;
  proposedAudience: Audience;
  motivation: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNotes: string;
  createdGroupId: string | null;
};

type ListResponse = { items: LeaderApplicationView[] };

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
 * ADR 0015 leader-application form.
 *
 * Any signed-in user can apply to lead a new group. The ministry
 * owner reviews the application; on approval the backend creates the
 * group atomically with the applicant as its leader.
 */
export default function LeaderApplicationPage() {
  const [history, setHistory] = useState<LeaderApplicationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<Audience>("christian");
  const [motivation, setMotivation] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<ListResponse>("/api/leader-applications/me");
      setHistory(data.items);
    } catch (e) {
      setError(errMsg(e, "Failed to load your applications"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = history.find((a) => a.status === "pending") ?? null;

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      await apiPost("/api/leader-applications", {
        proposedGroupName: name.trim(),
        proposedGroupDescription: description.trim(),
        proposedAudience: audience,
        motivation: motivation.trim(),
      });
      setName("");
      setDescription("");
      setAudience("christian");
      setMotivation("");
      await load();
    } catch (e) {
      setError(errMsg(e, "Submission failed"));
    } finally {
      setSubmitting(false);
    }
  }, [audience, description, load, motivation, name]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header className="space-y-2">
        <Eyebrow>Apply to lead</Eyebrow>
        <Heading level={1} size="md">
          Lead a new group
        </Heading>
        <p className="text-body-sm text-cream-muted">
          Tell us about the group you want to lead. The ministry owner
          will review your application; on approval the group is created with
          you as its leader.
        </p>
      </header>

      {error && <Banner tone="error">{error}</Banner>}

      {pending ? (
        <Card surface="raised" padding="lg" className="space-y-3">
          <Heading level={2} size="sm">
            Your pending application
          </Heading>
          <p className="text-body-sm text-cream-muted">
            <strong className="text-cream">{pending.proposedGroupName}</strong>{" "}
            · audience {pending.proposedAudience} · submitted{" "}
            {formatDate(pending.createdAt)}
          </p>
          <p className="text-body-sm text-cream-muted">
            We&rsquo;ll email you when the owner makes a decision. You can
            keep using JACOB in the meantime — browse boards or request to
            join an existing group from{" "}
            <a href="/discover" className="text-gold underline">
              Discover
            </a>
            .
          </p>
        </Card>
      ) : (
        <Card surface="raised" padding="lg" className="space-y-4">
          <Input
            label="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
          <Textarea
            label="Short description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            maxLength={500}
            helperText="Who is this group for and what will you do together?"
          />
          <label className="space-y-1 text-body-sm">
            <span className="text-cream">Audience</span>
            <select
              className="block w-full rounded border border-line bg-ink px-3 py-2 text-body text-cream"
              value={audience}
              onChange={(e) => setAudience(e.target.value as Audience)}
            >
              <option value="christian">christian</option>
              <option value="general">general</option>
            </select>
          </label>
          <Textarea
            label="Why are you the right person to lead this? (optional)"
            rows={3}
            value={motivation}
            onChange={(e) => setMotivation(e.target.value)}
            maxLength={2000}
          />
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => void submit()}
            loading={submitting}
            disabled={!name.trim() || !description.trim()}
          >
            Submit application
          </Button>
        </Card>
      )}

      {!loading && history.length > 0 && (
        <section className="space-y-3">
          <Heading level={2} size="sm">
            History
          </Heading>
          <ul className="space-y-2">
            {history.map((a) => (
              <li
                key={a.appId}
                className="rounded border border-line bg-ink-raised px-3 py-2 text-body-sm text-cream-muted"
              >
                <strong className="text-cream">{a.proposedGroupName}</strong>{" "}
                — {a.status}
                {a.status === "approved" && a.createdGroupId && (
                  <>
                    {" "}
                    → group{" "}
                    <code className="text-cream">{a.createdGroupId}</code>
                  </>
                )}
                {a.status === "rejected" && a.decisionNotes && (
                  <> — {a.decisionNotes}</>
                )}{" "}
                · {formatDate(a.createdAt)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
