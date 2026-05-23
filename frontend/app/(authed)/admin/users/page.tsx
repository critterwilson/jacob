"use client";

import { useCallback, useState } from "react";

import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

type AdminUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
  createdAt: string | null;
  isBanned: boolean;
};

type UserRoles = {
  isAdmin: boolean;
  isModerator: boolean;
  isMinistryOwner: boolean;
};

type BanDuration = "24h" | "7d" | "permanent";

const ROLE_DESCRIPTIONS: Record<keyof UserRoles, string> = {
  isAdmin: "Full platform access — can manage all users, groups, and settings.",
  isModerator:
    "Can review and action wellbeing flags and moderation queue items.",
  isMinistryOwner:
    "Can author and publish posts to the central organization feed.",
};

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-user ban action state
  const [banState, setBanState] = useState<Record<string, string>>({});

  // Per-user roles panel state: open/loading/data/error
  const [rolesOpen, setRolesOpen] = useState<Record<string, boolean>>({});
  const [rolesLoading, setRolesLoading] = useState<Record<string, boolean>>({});
  const [rolesData, setRolesData] = useState<Record<string, UserRoles>>({});
  const [rolesError, setRolesError] = useState<Record<string, string>>({});
  const [rolesActionState, setRolesActionState] = useState<
    Record<string, string>
  >({});

  const searchUsers = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const path = query
        ? `/api/admin/users?q=${encodeURIComponent(query)}`
        : "/api/admin/users";
      const data = await apiGet<{ users: AdminUser[] }>(path);
      setUsers(data.users);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message || `HTTP ${e.status}`
          : e instanceof Error
            ? e.message
            : "Failed to load users",
      );
    } finally {
      setLoading(false);
    }
  }, [user, query]);

  const banUser = async (uid: string, duration: BanDuration) => {
    if (!user) return;
    setBanState((s) => ({ ...s, [uid]: "loading" }));
    try {
      await apiPost(`/api/admin/users/${uid}/ban`, {
        reason: "Admin ban",
        duration,
      });
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, isBanned: true } : u)),
      );
      setBanState((s) => ({ ...s, [uid]: "done" }));
    } catch (e) {
      setBanState((s) => ({
        ...s,
        [uid]:
          e instanceof ApiError
            ? e.message || `HTTP ${e.status}`
            : e instanceof Error
              ? e.message
              : "error",
      }));
    }
  };

  const unbanUser = async (uid: string) => {
    if (!user) return;
    setBanState((s) => ({ ...s, [uid]: "loading" }));
    try {
      await apiPost(`/api/admin/users/${uid}/unban`, undefined);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, isBanned: false } : u)),
      );
      setBanState((s) => ({ ...s, [uid]: "done" }));
    } catch (e) {
      setBanState((s) => ({
        ...s,
        [uid]:
          e instanceof ApiError
            ? e.message || `HTTP ${e.status}`
            : e instanceof Error
              ? e.message
              : "error",
      }));
    }
  };

  const loadRoles = async (uid: string) => {
    if (!user) return;
    setRolesLoading((s) => ({ ...s, [uid]: true }));
    setRolesError((s) => ({ ...s, [uid]: "" }));
    try {
      const data = await apiGet<UserRoles>(`/api/admin/users/${uid}/roles`);
      setRolesData((s) => ({ ...s, [uid]: data }));
    } catch (e) {
      setRolesError((s) => ({
        ...s,
        [uid]:
          e instanceof ApiError
            ? e.message || `HTTP ${e.status}`
            : "Failed to load roles",
      }));
    } finally {
      setRolesLoading((s) => ({ ...s, [uid]: false }));
    }
  };

  const toggleRolesPanel = (uid: string) => {
    const opening = !rolesOpen[uid];
    setRolesOpen((s) => ({ ...s, [uid]: opening }));
    if (opening && !rolesData[uid]) {
      void loadRoles(uid);
    }
  };

  const toggleModerator = async (uid: string, grant: boolean) => {
    if (!user) return;
    if (
      !grant &&
      !window.confirm(
        "Remove moderator access? This user will no longer be able to review wellbeing flags.",
      )
    )
      return;
    setRolesActionState((s) => ({ ...s, [`${uid}:moderator`]: "loading" }));
    try {
      await apiPost(`/api/admin/users/${uid}/moderator`, { grant });
      setRolesData((s) => ({
        ...s,
        [uid]: { ...s[uid]!, isModerator: grant },
      }));
      setRolesActionState((s) => ({ ...s, [`${uid}:moderator`]: "" }));
    } catch (e) {
      setRolesActionState((s) => ({
        ...s,
        [`${uid}:moderator`]:
          e instanceof ApiError
            ? e.message || `HTTP ${e.status}`
            : "Error updating role",
      }));
    }
  };

  const toggleMinistryOwner = async (uid: string, grant: boolean) => {
    if (!user) return;
    if (
      !grant &&
      !window.confirm(
        "Remove Organization Owner access? This user will no longer be able to publish to the organization feed.",
      )
    )
      return;
    setRolesActionState((s) => ({
      ...s,
      [`${uid}:ministry_owner`]: "loading",
    }));
    try {
      if (grant) {
        await apiPost(`/api/admin/users/${uid}/ministry-owner`, undefined);
      } else {
        await apiDelete(`/api/admin/users/${uid}/ministry-owner`);
      }
      setRolesData((s) => ({
        ...s,
        [uid]: { ...s[uid]!, isMinistryOwner: grant },
      }));
      setRolesActionState((s) => ({ ...s, [`${uid}:ministry_owner`]: "" }));
    } catch (e) {
      setRolesActionState((s) => ({
        ...s,
        [`${uid}:ministry_owner`]:
          e instanceof ApiError
            ? e.message || `HTTP ${e.status}`
            : "Error updating role",
      }));
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Users</h1>
      <div className="mb-6 flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void searchUsers()}
          placeholder="Search by display name…"
          className="flex-1 rounded border border-line bg-ink-raised px-3 py-2 text-sm focus:outline-none focus-visible:shadow-glow-gold"
        />
        <Button
          variant="primary"
          onClick={() => void searchUsers()}
          loading={loading}
        >
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>
      {error && (
        <p className="mb-4 rounded border border-terracotta/40 bg-ink-raised p-3 text-sm text-terracotta">
          {error}
        </p>
      )}
      {users.length === 0 && !loading && (
        <p className="text-sm text-cream-muted">
          No users found. Run a search to load users.
        </p>
      )}
      <ul className="space-y-3">
        {users.map((u) => (
          <li
            key={u.uid}
            className="rounded border border-line bg-ink-raised shadow-sm"
          >
            {/* Main row */}
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-cream">
                  {u.displayName ?? "(no name)"}
                </p>
                <p className="truncate text-xs text-cream-muted">
                  {u.email ?? u.uid}
                </p>
                {u.isBanned && (
                  <span className="mt-1 inline-block rounded bg-ink-overlay px-2 py-0.5 text-xs font-medium text-terracotta">
                    Banned
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* Roles toggle */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => toggleRolesPanel(u.uid)}
                  aria-expanded={rolesOpen[u.uid] ?? false}
                >
                  {rolesOpen[u.uid] ? "Hide roles" : "Manage roles"}
                </Button>

                {/* Ban controls */}
                {banState[u.uid] === "loading" ? (
                  <span className="text-xs text-cream-muted">
                    Processing…
                  </span>
                ) : banState[u.uid] && banState[u.uid] !== "done" ? (
                  <span className="text-xs text-terracotta">
                    {banState[u.uid]}
                  </span>
                ) : u.isBanned ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void unbanUser(u.uid)}
                  >
                    Unban
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void banUser(u.uid, "24h")}
                    >
                      Ban 24h
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void banUser(u.uid, "7d")}
                    >
                      Ban 7d
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void banUser(u.uid, "permanent")}
                    >
                      Ban permanently
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Roles panel */}
            {rolesOpen[u.uid] && (
              <div className="border-t border-line px-4 py-3">
                {rolesLoading[u.uid] ? (
                  <p className="text-xs text-cream-muted">
                    Loading roles…
                  </p>
                ) : rolesError[u.uid] ? (
                  <p className="text-xs text-terracotta">
                    {rolesError[u.uid]}
                  </p>
                ) : rolesData[u.uid] ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-cream-muted">
                      Platform roles
                    </p>

                    {/* Admin claim — read-only, no endpoint to grant */}
                    <RoleRow
                      label="Admin"
                      description={ROLE_DESCRIPTIONS.isAdmin}
                      active={rolesData[u.uid]!.isAdmin}
                      readOnly
                      readOnlyNote={
                        rolesData[u.uid]!.isAdmin
                          ? undefined
                          : "Grant via Admin SDK script — no in-app endpoint."
                      }
                    />

                    {/* Moderator */}
                    <RoleRow
                      label="Moderator"
                      description={ROLE_DESCRIPTIONS.isModerator}
                      active={rolesData[u.uid]!.isModerator}
                      actionState={
                        rolesActionState[`${u.uid}:moderator`] ?? ""
                      }
                      onGrant={() => void toggleModerator(u.uid, true)}
                      onRevoke={() => void toggleModerator(u.uid, false)}
                    />

                    {/* Organization Owner */}
                    <RoleRow
                      label="Organization Owner"
                      description={ROLE_DESCRIPTIONS.isMinistryOwner}
                      active={rolesData[u.uid]!.isMinistryOwner}
                      actionState={
                        rolesActionState[`${u.uid}:ministry_owner`] ?? ""
                      }
                      onGrant={() => void toggleMinistryOwner(u.uid, true)}
                      onRevoke={() => void toggleMinistryOwner(u.uid, false)}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type RoleRowProps = {
  label: string;
  description: string;
  active: boolean;
  readOnly?: boolean;
  readOnlyNote?: string;
  actionState?: string;
  onGrant?: () => void;
  onRevoke?: () => void;
};

function RoleRow({
  label,
  description,
  active,
  readOnly,
  readOnlyNote,
  actionState,
  onGrant,
  onRevoke,
}: RoleRowProps) {
  const busy = actionState === "loading";
  const err = actionState && actionState !== "loading" ? actionState : null;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${active ? "bg-sage" : "bg-line"}`}
          />
          <span className="text-sm font-medium text-cream">{label}</span>
          {active && (
            <span className="rounded bg-ink-overlay px-1.5 py-0.5 text-xs font-medium text-sage">
              Active
            </span>
          )}
        </div>
        <p className="mt-0.5 pl-4 text-xs text-cream-muted">{description}</p>
        {readOnlyNote && (
          <p className="mt-0.5 pl-4 text-xs text-parchment-amber">
            {readOnlyNote}
          </p>
        )}
        {err && <p className="mt-0.5 pl-4 text-xs text-terracotta">{err}</p>}
      </div>
      {!readOnly && (
        <div className="shrink-0">
          {busy ? (
            <span className="text-xs text-cream-muted">Updating…</span>
          ) : active ? (
            <Button size="sm" variant="destructive" onClick={onRevoke}>
              Revoke
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onGrant}>
              Grant
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
