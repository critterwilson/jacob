// M6 of the data-layer migration: every previously-client-accessible
// path is now `allow read, write: if false;`. This test sweeps every
// collection the prior rules covered and asserts that both reads and
// writes from a signed-in user fail.
//
// The CG-`members` rule is the one exception: a user can read their
// OWN membership rows via a collection-group query. The CG read for
// other users' membership rows is denied. We verify both branches.
//
// Backend operations bypass these rules via the Admin SDK, so locking
// every client path to deny does not break the production flows — the
// FastAPI `/api/*` surface continues to read and write the same Firestore
// collections.

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  it,
} from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-jacob",
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

const authed = (uid: string): Firestore =>
  testEnv.authenticatedContext(uid).firestore();

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}

describe("M6 default-deny — users", () => {
  it("denies reading users/{uid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), { displayName: "Alice" });
    });
    await assertFails(getDoc(doc(authed("alice"), "users", "alice")));
  });

  it("denies writing users/{uid}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("denies reading users/{uid}/private/profile", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "users", "alice", "private", "profile")),
    );
  });

  it("denies reading users/{uid}/mutes/{otherUid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice", "mutes", "bob"), {
        mutedAt: Timestamp.now(),
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "users", "alice", "mutes", "bob")),
    );
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice", "mutes", "carol"), {
        mutedAt: serverTimestamp(),
      }),
    );
  });

  it("denies reading users/{uid}/blocks/{otherUid}", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "users", "alice", "blocks", "bob")),
    );
  });

  it("denies reading users/{uid}/devices/{deviceId}", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "users", "alice", "devices", "d1")),
    );
  });

  it("denies reading users/{uid}/notificationPrefs/main", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "users", "alice", "notificationPrefs", "main")),
    );
  });

  it("denies reading users/{uid}/notifications/{nid}", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "users", "alice", "notifications", "n1")),
    );
  });

  it("denies marking notifications as read", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice", "notifications", "n1"), {
        kind: "mention",
        readAt: null,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "users", "alice", "notifications", "n1"), {
        readAt: serverTimestamp(),
      }),
    );
  });

  it("denies reading users/{uid}/exports/{jobId}", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "users", "alice", "exports", "job1")),
    );
  });
});

describe("M6 default-deny — groups", () => {
  it("denies reading groups/{gid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1"), {
        name: "Test",
        isPrivate: false,
        createdAt: Timestamp.now(),
        memberCount: 1,
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "groups", "g1")));
  });

  it("denies creating groups/{gid}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1"), {
        name: "Test",
        isPrivate: false,
        createdAt: serverTimestamp(),
        memberCount: 1,
        schemaVersion: 1,
        createdBy: "alice",
        founderUid: "alice",
        inviteCode: "abc123",
      }),
    );
  });

  it("denies reading groups/{gid}/members/{uid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "members", "alice"), {
        role: "member",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "groups", "g1", "members", "alice")),
    );
  });

  it("denies writing groups/{gid}/members/{uid}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1", "members", "alice"), {
        role: "leader",
        joinedAt: serverTimestamp(),
        uid: "alice",
      }),
    );
  });

  it("denies reading groups/{gid}/messages/{mid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "alice",
        body: "hi",
        createdAt: Timestamp.now(),
        deletedAt: null,
        parentMessageId: null,
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "groups", "g1", "messages", "m1")),
    );
  });

  it("denies writing groups/{gid}/messages/{mid}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1", "messages", "m1"), {
        authorUid: "alice",
        body: "hi",
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
        stickerIds: [],
      }),
    );
  });

  it("denies reading reaction docs", async () => {
    await assertFails(
      getDoc(
        doc(
          authed("alice"),
          "groups",
          "g1",
          "messages",
          "m1",
          "reactions",
          "check-in",
          "users",
          "alice",
        ),
      ),
    );
  });

  it("denies writing reaction docs", async () => {
    await assertFails(
      setDoc(
        doc(
          authed("alice"),
          "groups",
          "g1",
          "messages",
          "m1",
          "reactions",
          "check-in",
          "users",
          "alice",
        ),
        { reactedAt: serverTimestamp() },
      ),
    );
  });

  it("denies reading invites", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "groups", "g1", "invites", "inv1")),
    );
  });

  it("denies reading joinRequests", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "groups", "g1", "joinRequests", "alice")),
    );
  });

  it("denies creating a joinRequest from the client", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1", "joinRequests", "alice"), {
        message: "please",
        requestedAt: serverTimestamp(),
        status: "pending",
      }),
    );
  });
});

describe("M6 default-deny — boards", () => {
  it("denies reading boards/{bid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1"), {
        name: "Prayer",
        slug: "prayer",
        archivedAt: null,
        postCount: 0,
        createdAt: Timestamp.now(),
        schemaVersion: 1,
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "boards", "b1")));
  });

  it("denies reading + writing posts", async () => {
    await assertFails(
      getDoc(doc(authed("alice"), "boards", "b1", "posts", "p1")),
    );
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        authorUid: "alice",
        body: "hi",
        stickerIds: ["pray"],
        mediaRefs: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        replyCount: 0,
        reactionCounts: {},
      }),
    );
  });

  it("denies reading + writing replies", async () => {
    await assertFails(
      getDoc(
        doc(authed("alice"), "boards", "b1", "posts", "p1", "replies", "r1"),
      ),
    );
    await assertFails(
      setDoc(
        doc(authed("alice"), "boards", "b1", "posts", "p1", "replies", "r1"),
        {
          authorUid: "alice",
          body: "hi",
          stickerIds: [],
          mediaRefs: [],
          createdAt: serverTimestamp(),
          editedAt: null,
          deletedAt: null,
        },
      ),
    );
  });

  it("denies reading + writing post reactions", async () => {
    await assertFails(
      getDoc(
        doc(
          authed("alice"),
          "boards",
          "b1",
          "posts",
          "p1",
          "reactions",
          "pray",
          "users",
          "alice",
        ),
      ),
    );
    await assertFails(
      setDoc(
        doc(
          authed("alice"),
          "boards",
          "b1",
          "posts",
          "p1",
          "reactions",
          "pray",
          "users",
          "alice",
        ),
        { reactedAt: serverTimestamp() },
      ),
    );
  });
});

describe("M6 default-deny — stickers + daily verse", () => {
  it("denies reading stickers/{sid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "stickers", "check-in"), {
        slug: "check-in",
        name: "Check-In",
        audience: "christian",
        order: 1,
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "stickers", "check-in")));
  });

  it("denies reading daily_verse/{day}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "daily_verse", "2026-05-01"), {
        ref: "John 3:16",
        text: "...",
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "daily_verse", "2026-05-01")),
    );
  });
});

describe("M6 default-deny — backend-only collections (unchanged)", () => {
  it("bans/{uid} stays denied", async () => {
    await assertFails(getDoc(doc(authed("alice"), "bans", "alice")));
  });

  it("audit_log/{eventId} stays denied", async () => {
    await assertFails(getDoc(doc(authed("alice"), "audit_log", "evt1")));
  });

  it("moderation_queue/{itemId} stays denied", async () => {
    await assertFails(getDoc(doc(authed("alice"), "moderation_queue", "i1")));
  });

  it("inviteCodes/{code} stays denied", async () => {
    await assertFails(getDoc(doc(authed("alice"), "inviteCodes", "ABC")));
  });

  it("uploads/{uploadId} stays denied", async () => {
    await assertFails(getDoc(doc(authed("alice"), "uploads", "u1")));
  });
});

describe("T58 default-deny — feature_flags", () => {
  it("denies reading feature_flags/{key} (read goes through GET /api/flags)", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "feature_flags", "presence_enabled"), {
        enabled: true,
        rolloutPercentage: 0,
        cohorts: { uids: [], orgIds: [], roles: [] },
        description: "",
        schemaVersion: 1,
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "feature_flags", "presence_enabled")),
    );
  });

  it("denies writing feature_flags/{key}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "feature_flags", "x"), {
        enabled: true,
        rolloutPercentage: 0,
      }),
    );
  });
});

describe("T54 default-deny — orgs + admins + members + invites", () => {
  it("denies reading orgs/{orgId}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "orgs", "o1"), {
        name: "Pilot",
        slug: "pilot",
        audience: "christian",
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "orgs", "o1")));
  });

  it("denies writing orgs/{orgId}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "orgs", "o1"), { name: "X" }),
    );
  });

  it("denies reading orgs/{orgId}/admins/{uid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "orgs", "o1", "admins", "alice"), {
        addedBy: "system",
        addedAt: serverTimestamp(),
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "orgs", "o1", "admins", "alice")),
    );
  });

  it("denies reading orgs/{orgId}/members/{uid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "orgs", "o1", "members", "alice"), {
        joinedAt: serverTimestamp(),
        groupIds: ["g1"],
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "orgs", "o1", "members", "alice")),
    );
  });

  it("denies reading org_slugs/{slug}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "org_slugs", "pilot"), { orgId: "o1" });
    });
    await assertFails(getDoc(doc(authed("alice"), "org_slugs", "pilot")));
  });

  it("denies reading org_consent_tokens/{token}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "org_consent_tokens", "tok"), {
        orgId: "o1",
        gid: "g1",
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "org_consent_tokens", "tok")),
    );
  });
});

describe("T63 default-deny — ncmec_cases", () => {
  it("denies reading ncmec_cases/{caseId}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "ncmec_cases", "c1"), {
        status: "pending",
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "ncmec_cases", "c1")));
  });

  it("denies writing ncmec_cases/{caseId}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "ncmec_cases", "c1"), { status: "x" }),
    );
  });
});

describe("T50 default-deny — watch_sessions", () => {
  it("denies reading groups/{gid}/watch_sessions/{sid}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "watch_sessions", "s1"), {
        videoId: "abc12345",
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "groups", "g1", "watch_sessions", "s1")),
    );
  });

  it("denies writing groups/{gid}/watch_sessions/{sid}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1", "watch_sessions", "s1"), {
        videoId: "x",
      }),
    );
  });
});

describe("T49 default-deny — events + rsvps", () => {
  it("denies reading groups/{gid}/events/{id}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "events", "e1"), {
        title: "Prayer",
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "groups", "g1", "events", "e1")),
    );
  });

  it("denies writing groups/{gid}/events/{id}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1", "events", "e1"), {
        title: "x",
      }),
    );
  });

  it("denies reading + writing the rsvp subcollection", async () => {
    await seed(async (db) => {
      await setDoc(
        doc(db, "groups", "g1", "events", "e1", "rsvps", "alice"),
        { status: "going" },
      );
    });
    await assertFails(
      getDoc(doc(authed("alice"), "groups", "g1", "events", "e1", "rsvps", "alice")),
    );
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1", "events", "e1", "rsvps", "alice"), {
        status: "going",
      }),
    );
  });
});

describe("T53 default-deny — unfurl_cache", () => {
  it("denies reading unfurl_cache/{urlHash}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "unfurl_cache", "abc123"), {
        title: "Cached",
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "unfurl_cache", "abc123")));
  });

  it("denies writing unfurl_cache/{urlHash}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "unfurl_cache", "abc123"), {
        title: "x",
      }),
    );
  });
});

describe("T52 default-deny — sermons", () => {
  it("denies reading groups/{gid}/sermons/{sermonId}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "sermons", "s1"), {
        title: "Sunday",
        sourceUrl: "https://example.com/s",
        sourceType: "other",
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "groups", "g1", "sermons", "s1")),
    );
  });

  it("denies writing groups/{gid}/sermons/{sermonId}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1", "sermons", "s1"), {
        title: "x",
      }),
    );
  });
});

describe("T51 default-deny — devotionals + reading_plans + plan_progress", () => {
  it("denies reading devotionals/{slug} (read goes through GET /api/devotionals)", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "devotionals", "psalm-23"), {
        title: "x",
        body: "y",
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "devotionals", "psalm-23")));
  });

  it("denies reading reading_plans/{slug}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "reading_plans", "john"), {
        title: "John 21",
        duration: 21,
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "reading_plans", "john")));
  });

  it("denies reading users/{uid}/plan_progress/{slug}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice", "plan_progress", "john"), {
        planSlug: "john",
        completedDays: [1],
        streak: 1,
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "users", "alice", "plan_progress", "john")),
    );
  });

  it("denies writing users/{uid}/plan_progress/{slug}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice", "plan_progress", "john"), {
        planSlug: "john",
        completedDays: [1],
        streak: 1,
      }),
    );
  });
});

describe("T59 default-deny — active_incidents", () => {
  it("denies reading active_incidents/{id} (read goes through GET /api/incidents)", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "active_incidents", "i1"), {
        severity: "SEV2",
        title: "x",
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "active_incidents", "i1")));
  });

  it("denies writing active_incidents/{id}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "active_incidents", "i1"), {
        severity: "SEV1",
      }),
    );
  });
});

describe("T55 default-deny — domain_claims", () => {
  it("denies reading domain_claims/{hostname}", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "domain_claims", "pilot.jacob.app"), {
        orgId: "o1",
        hostname: "pilot.jacob.app",
        type: "subdomain",
      });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "domain_claims", "pilot.jacob.app")),
    );
  });

  it("denies writing domain_claims/{hostname}", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "domain_claims", "x.jacob.app"), {
        orgId: "o1",
        hostname: "x.jacob.app",
      }),
    );
  });
});

describe("M6 — collection-group members read", () => {
  // The previous CG-members exception was removed in M6: Firestore
  // rules can't separate doc-level reads from CG queries at the rule
  // level, so any allow-rule on members granted direct doc reads too.
  // Admin tools should use the Admin SDK (which bypasses rules anyway).
  it("denies reading even own membership rows via CG query", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "members", "alice"), {
        role: "member",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
    });
    await assertFails(
      getDocs(
        query(
          collectionGroup(authed("alice"), "members"),
          where("uid", "==", "alice"),
        ),
      ),
    );
  });
});

describe("M6 — default-deny on unknown paths", () => {
  it("denies reading + writing arbitrary collections", async () => {
    await assertFails(getDoc(doc(authed("alice"), "weird", "x")));
    await assertFails(
      setDoc(doc(authed("alice"), "weird", "x"), { foo: "bar" }),
    );
  });
});

// Reference deleteDoc so the import isn't pruned by linters; the function
// is exercised indirectly via assertFails-on-write tests above.
void deleteDoc;
