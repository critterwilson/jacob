"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiError, apiPatch } from "@/lib/api";
import { useOrg } from "@/lib/hooks/useOrg";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export default function OrgSettingsPage() {
  const params = useParams();
  const orgId = String(
    Array.isArray(params?.orgId) ? params.orgId[0] : (params?.orgId ?? ""),
  );
  const { org, loading } = useOrg(orgId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setName(org.name);
      setDescription(org.description);
      setPrimaryColor(org.primaryColor ?? "");
    }
  }, [org]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    if (primaryColor && !HEX_RE.test(primaryColor)) {
      setError("primaryColor must be a 6-digit hex like '#0E5CAB'");
      setSaving(false);
      return;
    }
    try {
      await apiPatch(`/api/orgs/${encodeURIComponent(orgId)}`, {
        name,
        description,
        primaryColor: primaryColor || null,
      });
      setInfo("Saved.");
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to save",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    );
  }
  if (!org) {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-700">Org not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <header>
        <Link href={`/orgs/${orgId}`} className="text-xs text-gray-500 hover:text-gray-700">
          ← Org dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Settings</h1>
      </header>

      <section className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          <span className="text-xs text-gray-500">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-gray-500">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-gray-500">Primary color (hex)</span>
          <input
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#0E5CAB"
            className="mt-1 w-40 rounded border border-gray-300 px-2 py-1 font-mono"
          />
        </label>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {info && <span className="text-xs text-green-700">{info}</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
        <p className="text-xs text-gray-500">
          Custom subdomain and logo upload land with T55 (custom domains).
          AI-policy toggles land with T43–T47 if and when those tickets ship.
        </p>
      </section>
    </div>
  );
}
