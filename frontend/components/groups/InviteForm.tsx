"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="invite-expiry" className="mb-1 block text-xs font-medium text-gray-700">
            Expires
          </label>
          <select
            id="invite-expiry"
            {...register("expiry")}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="never">Never</option>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="invite-max-uses"
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Max uses
          </label>
          <select
            id="invite-max-uses"
            {...register("maxUses")}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="unlimited">Unlimited</option>
            <option value="1">1 use</option>
            <option value="10">10 uses</option>
            <option value="25">25 uses</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? "Generating…" : "Generate invite"}
        </button>
      </form>

      {serverError && (
        <p role="alert" className="text-sm text-red-600">
          {serverError}
        </p>
      )}

      {created && (
        <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 p-3">
          <span className="flex-1 truncate font-mono text-sm">{created.url}</span>
          <button
            onClick={() => void copy()}
            className="shrink-0 rounded bg-green-600 px-3 py-1 text-xs text-white"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
