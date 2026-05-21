"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ReadingPlanForm } from "@/components/reading-plans/ReadingPlanForm";
import { Eyebrow, Heading, Link } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  type ReadingPlanCreatePayload,
  type ReadingPlanUpdatePayload,
  useReadingPlansAdmin,
} from "@/lib/hooks/useReadingPlans";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

export default function NewReadingPlanPage() {
  const router = useRouter();
  const claims = useRoleClaims();
  const { createPlan } = useReadingPlansAdmin();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (claims === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }

  if (!claims.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-6">
        <Link href="/reading-plans" variant="muted" className="text-caption">
          ← Reading plans
        </Link>
        <p className="text-body-sm text-cream">
          Admin access required to create reading plans.
        </p>
      </div>
    );
  }

  const handleSubmit = async (values: ReadingPlanCreatePayload | ReadingPlanUpdatePayload) => {
    setPending(true);
    setError(null);
    try {
      const plan = await createPlan(values as ReadingPlanCreatePayload);
      if (plan) {
        router.push(`/reading-plans/${plan.slug}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === "slug_taken"
            ? "That URL slug is already in use. Choose a different one."
            : err.message || "Failed to create plan.",
        );
      } else {
        setError("Failed to create plan.");
      }
      setPending(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link href="/reading-plans" variant="muted" className="text-caption">
        ← Reading plans
      </Link>

      <header className="space-y-1">
        <Eyebrow>Admin</Eyebrow>
        <Heading level={1} size="md">
          New reading plan
        </Heading>
      </header>

      <ReadingPlanForm
        mode="create"
        pending={pending}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/reading-plans")}
      />
    </main>
  );
}
