"use client";

import { type FormEvent, useId, useState } from "react";

import { Banner, Button, Select } from "@/components/ui";
import type {
  ReadingPlanCreatePayload,
  ReadingPlanDayInput,
  ReadingPlanUpdatePayload,
} from "@/lib/hooks/useReadingPlans";

type DraftDay = ReadingPlanDayInput & { _key: string };

function nextKey() {
  return String(Math.random());
}

function toDrafts(days: ReadingPlanDayInput[]): DraftDay[] {
  return days.map((d) => ({ ...d, _key: nextKey() }));
}

export type ReadingPlanFormValues = {
  slug: string;
  title: string;
  description: string;
  audience: "christian" | "general";
  days: ReadingPlanDayInput[];
};

type Props = {
  mode: "create" | "edit";
  initial?: Partial<ReadingPlanFormValues>;
  pending?: boolean;
  error?: string | null;
  onSubmit: (values: ReadingPlanCreatePayload | ReadingPlanUpdatePayload) => void;
  onCancel?: () => void;
};

const inputClass =
  "w-full rounded border border-line bg-ink-overlay px-3 py-2 " +
  "font-sans text-body-sm text-cream placeholder:text-cream-muted " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

const textareaClass =
  inputClass + " resize-none";

export function ReadingPlanForm({
  mode,
  initial = {},
  pending = false,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const formId = useId();
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [title, setTitle] = useState(initial.title ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [audience, setAudience] = useState<"christian" | "general">(
    initial.audience ?? "christian",
  );
  const [days, setDays] = useState<DraftDay[]>(() =>
    toDrafts(initial.days ?? [{ scriptureRef: "", prompt: "" }]),
  );
  const [touched, setTouched] = useState(false);

  const updateDay = (key: string, field: keyof ReadingPlanDayInput, value: string) => {
    setDays((prev) =>
      prev.map((d) => (d._key === key ? { ...d, [field]: value } : d)),
    );
  };

  const addDay = () => {
    setDays((prev) => [...prev, { scriptureRef: "", prompt: "", _key: nextKey() }]);
  };

  const removeDay = (key: string) => {
    setDays((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((d) => d._key !== key);
    });
  };

  const slugValid = mode === "edit" || /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
  const titleValid = title.trim().length > 0;
  const daysValid = days.every((d) => d.scriptureRef.trim().length > 0);
  const formValid = (mode === "edit" || slugValid) && titleValid && daysValid;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid) return;

    const dayInputs: ReadingPlanDayInput[] = days.map((d) => ({
      scriptureRef: d.scriptureRef.trim(),
      prompt: d.prompt.trim(),
    }));

    if (mode === "create") {
      onSubmit({
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim(),
        audience,
        days: dayInputs,
      } satisfies ReadingPlanCreatePayload);
    } else {
      const payload: ReadingPlanUpdatePayload = {};
      if (title.trim() !== (initial.title ?? "")) payload.title = title.trim();
      if (description.trim() !== (initial.description ?? ""))
        payload.description = description.trim();
      if (audience !== (initial.audience ?? "christian")) payload.audience = audience;
      payload.days = dayInputs;
      onSubmit(payload);
    }
  };

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-5">
      {mode === "create" && (
        <div className="space-y-1">
          <label
            htmlFor={`${formId}-slug`}
            className="block text-caption text-cream-muted"
          >
            URL slug <span className="text-terracotta">*</span>
          </label>
          <input
            id={`${formId}-slug`}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="e.g. john-7-day"
            className={inputClass}
            aria-describedby={
              touched && !slugValid ? `${formId}-slug-err` : undefined
            }
          />
          {touched && !slugValid && (
            <p id={`${formId}-slug-err`} role="alert" className="text-caption text-terracotta">
              Lowercase letters, digits, and hyphens only (e.g. john-7-day).
            </p>
          )}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor={`${formId}-title`} className="block text-caption text-cream-muted">
          Title <span className="text-terracotta">*</span>
        </label>
        <input
          id={`${formId}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. 7 Days in the Gospel of John"
          maxLength={200}
          className={inputClass}
          aria-describedby={
            touched && !titleValid ? `${formId}-title-err` : undefined
          }
        />
        {touched && !titleValid && (
          <p id={`${formId}-title-err`} role="alert" className="text-caption text-terracotta">
            Title is required.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label
          htmlFor={`${formId}-description`}
          className="block text-caption text-cream-muted"
        >
          Description
        </label>
        <textarea
          id={`${formId}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A short description of the plan."
          maxLength={1000}
          rows={3}
          className={textareaClass}
        />
      </div>

      <div className="space-y-1">
        <Select
          label="Audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value as "christian" | "general")}
        >
          <option value="christian">Christian</option>
          <option value="general">General</option>
        </Select>
      </div>

      <section aria-label="Days" className="space-y-3">
        <h3 className="text-caption font-medium text-cream-muted">
          Days ({days.length})
        </h3>

        <ol className="space-y-3">
          {days.map((day, idx) => (
            <li
              key={day._key}
              className="rounded-lg border border-line bg-ink-overlay p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption font-medium text-cream">
                  Day {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeDay(day._key)}
                  disabled={days.length <= 1}
                  aria-label={`Remove day ${idx + 1}`}
                  className={
                    "text-caption text-cream-muted transition-colors " +
                    (days.length <= 1
                      ? "opacity-30 cursor-not-allowed"
                      : "hover:text-terracotta focus-visible:text-terracotta")
                  }
                >
                  Remove
                </button>
              </div>

              <div className="space-y-2">
                <input
                  value={day.scriptureRef}
                  onChange={(e) => updateDay(day._key, "scriptureRef", e.target.value)}
                  placeholder="Scripture reference (e.g. John 1:1-14)"
                  maxLength={200}
                  aria-label={`Day ${idx + 1} scripture reference`}
                  className={inputClass}
                />
                {touched && !day.scriptureRef.trim() && (
                  <p role="alert" className="text-caption text-terracotta">
                    Scripture reference is required.
                  </p>
                )}
                <textarea
                  value={day.prompt}
                  onChange={(e) => updateDay(day._key, "prompt", e.target.value)}
                  placeholder="Reflection prompt (optional)"
                  maxLength={500}
                  rows={2}
                  aria-label={`Day ${idx + 1} prompt`}
                  className={textareaClass}
                />
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={addDay}
          className={
            "w-full rounded border border-dashed border-line py-2 text-body-sm " +
            "text-cream-muted transition-colors hover:border-gold hover:text-cream " +
            "focus:outline-none focus-visible:shadow-glow-gold"
          }
        >
          + Add day
        </button>
      </section>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex justify-end gap-3">
        {onCancel && (
          <Button type="button" variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={pending}
          disabled={pending}
        >
          {pending
            ? mode === "create"
              ? "Creating…"
              : "Saving…"
            : mode === "create"
              ? "Create plan"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
