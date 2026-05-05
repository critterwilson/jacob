"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Banner, Button, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

const createInviteSchema = z.object({
  expiry: z.enum(["never", "24h", "7d", "30d"]),
  maxUses: z.enum(["unlimited", "1", "10", "25"]),
});

type FormValues = z.infer<typeof createInviteSchema>;

type InviteResult = {
  inviteId: string;
  code: string;
  url: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
};

type Props = { gid: string };

export function InviteForm({ gid }: Props) {
  const { user } = useAuth();
  const [created, setCreated] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(createInviteSchema),
    defaultValues: { expiry: "never", maxUses: "unlimited" },
  });

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setServerError(null);
    setCreated(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/groups/${gid}/invites`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(values),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setServerError(err?.error?.message ?? "Failed to create invite.");
        return;
      }
      setCreated((await res.json()) as InviteResult);
    } catch {
      setServerError("Something went wrong.");
    }
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-wrap items-end gap-3"
      >
        <Select label="Expires" {...register("expiry")} className="min-w-[8rem]">
          <option value="never">Never</option>
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
        </Select>
        <Select label="Max uses" {...register("maxUses")} className="min-w-[8rem]">
          <option value="unlimited">Unlimited</option>
          <option value="1">1 use</option>
          <option value="10">10 uses</option>
          <option value="25">25 uses</option>
        </Select>
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Generating…" : "Generate invite"}
        </Button>
      </form>

      {serverError && <Banner tone="error">{serverError}</Banner>}

      {created && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-ink-raised p-3">
          <span className="flex-1 truncate font-mono text-body-sm text-cream">
            {created.url}
          </span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void copy()}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}
