"use client";

import { type FormEvent, useEffect, useState } from "react";

import { Banner, Button, Input, Select, Textarea } from "@/components/ui";

export type BoardAudience = "christian" | "general";

export type BoardFormValues = {
  name: string;
  slug: string;
  description: string;
  audience: BoardAudience;
};

export type BoardSubmitValues =
  | { mode: "create"; values: BoardFormValues }
  | {
      mode: "edit";
      values: Pick<BoardFormValues, "name" | "description" | "audience">;
    };

type Props = {
  mode: "create" | "edit";
  initial?: Partial<BoardFormValues>;
  pending?: boolean;
  error?: string | null;
  submitLabel?: string;
  onSubmit: (payload: BoardSubmitValues) => void;
  onCancel?: () => void;
};

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function BoardForm({
  mode,
  initial = {},
  pending = false,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initial.name ?? "");
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState(initial.description ?? "");
  const [audience, setAudience] = useState<BoardAudience>(
    initial.audience ?? "general",
  );
  const [touched, setTouched] = useState(false);

  // Keep slug in sync with name (create mode only) until the user edits it.
  useEffect(() => {
    if (mode !== "create") return;
    if (slugTouched) return;
    setSlug(toSlug(name));
  }, [name, slugTouched, mode]);

  const nameValid = name.trim().length > 0;
  const slugValid = mode === "edit" || SLUG_RE.test(slug);
  const formValid = nameValid && slugValid;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid) return;

    if (mode === "create") {
      onSubmit({
        mode: "create",
        values: {
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim(),
          audience,
        },
      });
    } else {
      onSubmit({
        mode: "edit",
        values: {
          name: name.trim(),
          description: description.trim(),
          audience,
        },
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Prayer & Praise"
        maxLength={80}
        required
        autoFocus={mode === "create"}
        error={touched && !nameValid ? "Name is required." : undefined}
      />

      {mode === "create" ? (
        <Input
          label="URL slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          placeholder="prayer-praise"
          maxLength={80}
          required
          className="font-mono"
          helperText="Lowercase letters, numbers, and hyphens. Permanent — used in the board URL."
          error={
            touched && !slugValid
              ? "Use lowercase letters, numbers, and hyphens only (e.g. prayer-praise)."
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="font-sans text-label text-cream">URL slug</span>
          <p className="font-mono text-body-sm text-cream-muted">
            {initial.slug}
          </p>
          <p className="font-sans text-body-sm text-cream-muted">
            The slug is permanent and can&apos;t be changed.
          </p>
        </div>
      )}

      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What the board is for. Shown to members when they browse boards."
        maxLength={500}
        rows={3}
      />

      <Select
        label="Audience"
        value={audience}
        onChange={(e) => setAudience(e.target.value as BoardAudience)}
        helperText={
          audience === "christian"
            ? "Discussions assume shared Christian context."
            : "Open to everyone — keep posts welcoming to people new to faith."
        }
      >
        <option value="general">General</option>
        <option value="christian">Christian</option>
      </Select>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            fullWidth="mobile"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          fullWidth="mobile"
          loading={pending}
          disabled={pending}
        >
          {submitLabel ??
            (mode === "create"
              ? pending
                ? "Creating…"
                : "Create board"
              : pending
                ? "Saving…"
                : "Save changes")}
        </Button>
      </div>
    </form>
  );
}
