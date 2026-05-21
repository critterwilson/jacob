"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ReadingPlanForm } from "@/components/reading-plans/ReadingPlanForm";
import { Eyebrow, Heading, Link } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  type ReadingPlanCreatePayload,
  type ReadingPlanUpdatePayload,
  useReadingPlan,
  useReadingPlansAdmin,
} from "@/lib/hooks/useReadingPlans";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

export default function EditReadingPlanPage() {
  const params = useParams();
  const slug = String(
    Array.isArray(params?.slug) ? params.slug[0] : (params?.slug ?? ""),
  );
  const router = useRouter();
  const claims = useRoleClaims();
  const { plan, loading } = useReadingPlan(slug);
  const { updatePlan, deletePlan } = useReadingPlansAdmin();
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (claims === null || loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }

  if (!claims.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-6">
        <Link href={`/reading-plans/${slug}`} variant="muted" className="text-caption">
          ← Back to plan
        </Link>
        <p className="text-body-sm text-cream">
          Admin access required to edit reading plans.
        </p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-6">
        <Link href="/reading-plans" variant="muted" className="text-caption">
          ← Reading plans
        </Link>
        <p className="text-body-sm text-cream">Plan not found.</p>
      </div>
    );
  }

  const handleSubmit = async (values: ReadingPlanCreatePayload | ReadingPlanUpdatePayload) => {
    setPending(true);
    setError(null);
    try {
      const updated = await updatePlan(slug, values as ReadingPlanUpdatePayload);
      if (updated) {
        router.push(`/reading-plans/${slug}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to save changes.");
      } else {
        setError("Failed to save changes.");
      }
      setPending(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deletePlan(slug);
      router.push("/reading-plans");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to delete plan.");
      } else {
        setError("Failed to delete plan.");
      }
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link href={`/reading-plans/${slug}`} variant="muted" className="text-caption">
        ← Back to plan
      </Link>

      <header className="space-y-1">
        <Eyebrow>Admin</Eyebrow>
        <Heading level={1} size="md">
          Edit: {plan.title}
        </Heading>
      </header>

      <ReadingPlanForm
        mode="edit"
        initial={{
          slug: plan.slug,
          title: plan.title,
          description: plan.description,
          audience: plan.audience,
          days: plan.days.map((d) => ({
            scriptureRef: d.scriptureRef,
            prompt: d.prompt,
          })),
        }}
        pending={pending}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/reading-plans/${slug}`)}
      />

      <section className="rounded-lg border border-terracotta/40 p-4 space-y-3">
        <p className="text-body-sm text-cream-muted">
          Deleting a plan is permanent and cannot be undone. User progress records
          are not removed.
        </p>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={
            "rounded px-4 py-2 text-body-sm font-medium transition-colors " +
            (confirmDelete
              ? "bg-terracotta text-white hover:bg-terracotta/80"
              : "border border-terracotta/60 text-terracotta hover:bg-terracotta/10")
          }
        >
          {deleting
            ? "Deleting…"
            : confirmDelete
              ? "Confirm delete"
              : "Delete plan"}
        </button>
        {confirmDelete && !deleting && (
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="ml-3 text-caption text-cream-muted hover:text-cream"
          >
            Cancel
          </button>
        )}
      </section>
    </main>
  );
}
