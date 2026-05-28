"use client";

import { type FormEvent, useState } from "react";

import { Banner, Button, Input, Select, Textarea } from "@/components/ui";

export type BoardAudience = "christian" | "general";

export type BoardFormValues = {
  name: string;
  description: string;
  audience: BoardAudience;
};

// `slug` is server-derived on create and immutable thereafter, so it
// appears in `initial` (for the edit-mode read-only display) but not in
// the submit payload.
export type BoardInitialValues = BoardFormValues & { slug?: string };

export type BoardSubmitValues =
  | { mode: "create"; values: BoardFormValues }
  | { mode: "edit"; values: BoardFormValues };

type Props = {
  mode: "create" | "edit";
  initial?: Partial<BoardInitialValues>;
  pending?: boolean;
  error?: string | null;
  submitLabel?: string;
  onSubmit: (payload: BoardSubmitValues) => void;
  onCancel?: () => void;
};

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
  const [description, setDescription] = useState(initial.description ?? "");
  const [audience, setAudience] = useState<BoardAudience>(
    initial.audience ?? "general",
  );
  const [touched, setTouched] = useState(false);

  const nameValid = name.trim().length > 0;
  const formValid = nameValid;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid) return;

    onSubmit({
      mode,
      values: {
        name: name.trim(),
        description: description.trim(),
        audience,
      },
    });
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

      {mode === "edit" && initial.slug && (
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
