/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { apiGet as apiGetExport } from "@/lib/api";
import { useMyOrgs } from "@/lib/hooks/useMyOrgs";
import { useOrg, useOrgDashboard } from "@/lib/hooks/useOrg";
import { useOrgAdmins } from "@/lib/hooks/useOrgAdmins";
import { useOrgGroups } from "@/lib/hooks/useOrgGroups";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;

describe("org hooks", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it("useOrg fetches the org and surfaces it", async () => {
    apiGet.mockResolvedValue({
      orgId: "o1",
      name: "Pilot",
      slug: "pilot",
      description: "",
      audience: "christian",
      logoUrl: null,
      primaryColor: null,
      customDomain: null,
      customSubdomain: null,
      createdAt: null,
      schemaVersion: 1,
      llmModerationPolicy: "off",
      threadSummaryEnabled: false,
      semanticSearchEnabled: false,
      prayerClusteringEnabled: false,
      transparencyReportEnabled: false,
    });
    const { result } = renderHook(() => useOrg("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.org?.slug).toBe("pilot");
    expect(apiGet).toHaveBeenCalledWith("/api/orgs/o1", expect.anything());
  });

  it("useOrg returns null when no orgId is supplied (no fetch)", () => {
    const { result } = renderHook(() => useOrg(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.org).toBeNull();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("useOrgDashboard surfaces the dashboard payload", async () => {
    apiGet.mockResolvedValue({
      orgId: "o1",
      name: "Pilot",
      audience: "christian",
      groupCount: 3,
      memberCount: 17,
      archivedGroupCount: 1,
      pendingModerationCount: 2,
    });
    const { result } = renderHook(() => useOrgDashboard("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dashboard?.groupCount).toBe(3);
    expect(result.current.dashboard?.pendingModerationCount).toBe(2);
  });

  it("useOrgGroups returns the group list", async () => {
    apiGet.mockResolvedValue({
      groups: [
        {
          gid: "g1",
          name: "Group One",
          memberCount: 5,
          archivedAt: null,
          createdAt: null,
        },
      ],
    });
    const { result } = renderHook(() => useOrgGroups("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].name).toBe("Group One");
  });

  it("useOrgAdmins returns the admin list", async () => {
    apiGet.mockResolvedValue({
      admins: [{ uid: "admin-1", addedBy: "platform", addedAt: null }],
    });
    const { result } = renderHook(() => useOrgAdmins("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.admins[0].uid).toBe("admin-1");
  });

  it("useOrg surfaces 403 errors", async () => {
    apiGet.mockRejectedValue(
      new (class ApiError extends Error {
        status = 403;
        code = "forbidden";
      })(),
    );
    const { result } = renderHook(() => useOrg("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.org).toBeNull();
  });

  it("useMyOrgs returns the caller's org list", async () => {
    apiGet.mockResolvedValue({
      orgs: [
        {
          orgId: "o1",
          name: "Grace Church",
          slug: "grace",
          audience: "christian",
          logoUrl: null,
          role: "admin",
        },
      ],
    });
    const { result } = renderHook(() => useMyOrgs());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.orgs).toHaveLength(1);
    expect(result.current.orgs[0].orgId).toBe("o1");
    expect(result.current.orgs[0].role).toBe("admin");
    expect(apiGet).toHaveBeenCalledWith(
      "/api/users/me/orgs",
      expect.anything(),
    );
  });

  it("useMyOrgs returns empty list when the user has no orgs", async () => {
    apiGet.mockResolvedValue({ orgs: [] });
    const { result } = renderHook(() => useMyOrgs());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.orgs).toHaveLength(0);
  });
});
