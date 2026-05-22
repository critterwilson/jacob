"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
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
      <div className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </div>
    );
  }
  if (!org) {
    return (
      <div className="p-8">
        <p className="text-sm text-cream-muted">Org not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <header>
        <Link href={`/orgs/${orgId}`} className="text-xs text-cream-muted hover:text-cream">
          ← Org dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Settings</h1>
      </header>

      <section className="space-y-3 rounded border border-line bg-ink-raised p-4">
        <label className="block text-sm">
          <span className="text-xs text-cream-muted">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-ink-overlay px-2 py-1 text-cream focus:outline-none focus-visible:shadow-glow-gold"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-cream-muted">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border border-line bg-ink-overlay px-2 py-1 text-cream focus:outline-none focus-visible:shadow-glow-gold"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-cream-muted">Primary color (hex)</span>
          <input
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#0E5CAB"
            className="mt-1 w-40 rounded border border-line bg-ink-overlay px-2 py-1 font-mono text-cream focus:outline-none focus-visible:shadow-glow-gold"
          />
        </label>
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="primary"
            onClick={save}
            loading={saving}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          {info && <span className="text-xs text-sage">{info}</span>}
          {error && <span className="text-xs text-terracotta">{error}</span>}
        </div>
        <p className="text-xs text-cream-muted">
          Logo upload (via the existing moderation pipeline) lands in a
          follow-up. AI-policy toggles land with T43–T47 if those tickets
          ship.
        </p>
      </section>

      <BrandingSection orgId={orgId} />
    </div>
  );
}

type DomainStatus = {
  orgId: string;
  customSubdomain: string | null;
  customSubdomainHostname: string | null;
  customDomain:
    | {
        hostname: string;
        status: "pending" | "verified" | "active" | "failed";
        certStatus: "not_started" | "provisioning" | "active" | "failed";
        verifiedAt: string | null;
        txtRecord: string | null;
      }
    | null;
  message: string | null;
};

function BrandingSection({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subdomain, setSubdomain] = useState("");
  const [subPending, setSubPending] = useState(false);

  const [vanityHost, setVanityHost] = useState("");
  const [vanityPending, setVanityPending] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<DomainStatus>(
        `/api/orgs/${encodeURIComponent(orgId)}/custom-domain/status`,
      );
      setStatus(res);
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to load",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const claimSub = async () => {
    if (!subdomain) return;
    setSubPending(true);
    setError(null);
    try {
      await apiPost(`/api/orgs/${encodeURIComponent(orgId)}/subdomain`, {
        subdomain,
      });
      setSubdomain("");
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to claim",
      );
    } finally {
      setSubPending(false);
    }
  };

  const releaseSub = async () => {
    if (!confirm("Release the subdomain? It enters a 30-day cooling-off window.")) return;
    try {
      await apiDelete(`/api/orgs/${encodeURIComponent(orgId)}/subdomain`);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to release",
      );
    }
  };

  const claimVanity = async () => {
    if (!vanityHost) return;
    setVanityPending(true);
    setError(null);
    try {
      await apiPost<{ txtRecord: string }>(
        `/api/orgs/${encodeURIComponent(orgId)}/custom-domain`,
        { hostname: vanityHost },
      );
      setVanityHost("");
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to claim",
      );
    } finally {
      setVanityPending(false);
    }
  };

  const releaseVanity = async () => {
    if (!confirm("Release the custom domain?")) return;
    try {
      await apiDelete(`/api/orgs/${encodeURIComponent(orgId)}/custom-domain`);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to release",
      );
    }
  };

  return (
    <section className="space-y-4 rounded border border-line bg-ink-raised p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-cream-muted">
        Branding & domains
      </h2>
      {error && <p className="text-xs text-terracotta">{error}</p>}
      {loading ? (
        <p className="text-xs text-cream-muted">Loading…</p>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-medium">JACOB subdomain</h3>
            <p className="text-xs text-cream-muted">
              Claim a `*.jacob.app` host. Members visit
              `&lt;your-name&gt;.jacob.app`. Claims are unique platform-wide.
            </p>
            {status?.customSubdomain ? (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="font-mono">
                  {status.customSubdomainHostname}
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={releaseSub}
                >
                  Release
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  value={subdomain}
                  onChange={(e) =>
                    setSubdomain(e.target.value.toLowerCase().trim())
                  }
                  placeholder="our-church"
                  className="flex-1 rounded border border-line bg-ink-overlay px-2 py-1 text-sm text-cream focus:outline-none focus-visible:shadow-glow-gold"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={claimSub}
                  loading={subPending}
                  disabled={!subdomain || subPending}
                >
                  {subPending ? "…" : "Claim"}
                </Button>
              </div>
            )}
          </div>

          <div className="border-t border-line pt-3">
            <h3 className="text-sm font-medium">Custom domain</h3>
            <p className="text-xs text-cream-muted">
              Map a domain you already own (e.g. `groups.your-church.org`).
              Verify via TXT record; an operator provisions the cert
              (5–30 minutes once verified).
            </p>
            {status?.customDomain ? (
              <div className="mt-2 space-y-1 text-sm">
                <p>
                  <span className="font-mono">
                    {status.customDomain.hostname}
                  </span>{" "}
                  —{" "}
                  <span
                    className={
                      status.customDomain.status === "active"
                        ? "text-sage"
                        : status.customDomain.status === "verified"
                          ? "text-parchment-amber"
                          : status.customDomain.status === "failed"
                            ? "text-terracotta"
                            : "text-cream-muted"
                    }
                  >
                    {status.customDomain.status}
                  </span>{" "}
                  (cert: {status.customDomain.certStatus})
                </p>
                {status.customDomain.txtRecord &&
                  status.customDomain.status === "pending" && (
                    <p className="text-xs">
                      Add a TXT record on{" "}
                      <span className="font-mono">
                        {status.customDomain.hostname}
                      </span>{" "}
                      with value:
                      <br />
                      <code className="mt-1 block break-all rounded bg-ink-overlay p-2 text-[11px]">
                        {status.customDomain.txtRecord}
                      </code>
                    </p>
                  )}
                {status.message && (
                  <p className="text-xs text-cream-muted">{status.message}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={load}
                  >
                    Re-check status
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={releaseVanity}
                  >
                    Release
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  value={vanityHost}
                  onChange={(e) =>
                    setVanityHost(e.target.value.toLowerCase().trim())
                  }
                  placeholder="groups.your-church.org"
                  className="flex-1 rounded border border-line bg-ink-overlay px-2 py-1 text-sm font-mono text-cream focus:outline-none focus-visible:shadow-glow-gold"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={claimVanity}
                  loading={vanityPending}
                  disabled={!vanityHost || vanityPending}
                >
                  {vanityPending ? "…" : "Claim"}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
