import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
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
const anon = (): Firestore =>
  testEnv.unauthenticatedContext().firestore();

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}

// Seed a fully-formed group with one leader and one regular member.
async function seedGroup(opts: {
  gid: string;
  createdBy: string;
  leaderUid: string;
  memberUid?: string;
  isPrivate?: boolean;
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "Test Group",
      description: "",
      createdBy: opts.createdBy,
      createdAt: Timestamp.now(),
      isPrivate: opts.isPrivate ?? false,
      inviteCode: "abc123",
      memberCount: opts.memberUid ? 2 : 1,
      stickerSet: "christian",
      schemaVersion: 1,
    });
    await setDoc(doc(db, "groups", opts.gid, "members", opts.leaderUid), {
      role: "leader",
      joinedAt: Timestamp.now(),
    });
    if (opts.memberUid) {
      await setDoc(doc(db, "groups", opts.gid, "members", opts.memberUid), {
        role: "member",
        joinedAt: Timestamp.now(),
      });
    }
  });
}

async function seedBan(uid: string, expiresAt: Date) {
  await seed(async (db) => {
    await setDoc(doc(db, "bans", uid), {
      reason: "test",
      bannedBy: "admin",
      expiresAt: Timestamp.fromDate(expiresAt),
    });
  });
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
describe("users/{uid}", () => {
  it("owner reads own user doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(getDoc(doc(authed("alice"), "users", "alice")));
  });

  // C1 fix: any authenticated user can read public user docs so that
  // display names resolve in group chat (public doc holds no PII).
  it("any authenticated user can read another user's public doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), { displayName: "Alice" });
    });
    await assertSucceeds(getDoc(doc(authed("bob"), "users", "alice")));
  });

  it("denies unauthenticated read of any user doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), { displayName: "Alice" });
    });
    await assertFails(getDoc(doc(anon(), "users", "alice")));
  });

  it("creates own user doc with required fields", async () => {
    await assertSucceeds(
      setDoc(doc(authed("alice"), "users", "alice"), {
        displayName: "Alice",
        photoURL: null,
        schemaVersion: 1,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("denies creating a user doc for someone else", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "bob"), {
        displayName: "Bob",
        schemaVersion: 1,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("denies create with wrong schemaVersion", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 2,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("denies create that tries to set role to admin", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice"), {
        displayName: "Alice",
        role: "admin",
        schemaVersion: 1,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("owner updates own displayName", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "users", "alice"), {
        displayName: "Alice Renamed",
      }),
    );
  });

  it("denies user trying to escalate role", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        role: "member",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "users", "alice"), {
        role: "admin",
      }),
    );
  });

  it("denies updates to another user's doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "users", "alice"), {
        displayName: "Hacked",
      }),
    );
  });

  it("denies client deletion of user doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(deleteDoc(doc(authed("alice"), "users", "alice")));
  });

  it("denies client setting groupIds directly on update (H12)", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "users", "alice"), {
        groupIds: ["some-group-id"],
      }),
    );
  });

  it("denies user create with unknown extra field (H3)", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        hackerField: "evil",
      }),
    );
  });

  // M10 — minor-user rule coverage gap
  it("allows owner to set isMinor=true on create", async () => {
    await assertSucceeds(
      setDoc(doc(authed("alice"), "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        isMinor: true,
      }),
    );
  });

  it("allows owner to flip isMinor on update", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
        isMinor: false,
      });
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "users", "alice"), {
        isMinor: true,
      }),
    );
  });

  it("denies non-owner updating isMinor on someone else's doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "users", "alice"), {
        isMinor: true,
      }),
    );
  });

  describe("private subcollection", () => {
    it("owner reads own private profile", async () => {
      await seed(async (db) => {
        await setDoc(doc(db, "users", "alice", "private", "profile"), {
          email: "alice@example.com",
        });
      });
      await assertSucceeds(
        getDoc(doc(authed("alice"), "users", "alice", "private", "profile")),
      );
    });

    it("denies others reading private profile", async () => {
      await seed(async (db) => {
        await setDoc(doc(db, "users", "alice", "private", "profile"), {
          email: "alice@example.com",
        });
      });
      await assertFails(
        getDoc(doc(authed("bob"), "users", "alice", "private", "profile")),
      );
    });

    it("owner writes own private profile", async () => {
      await assertSucceeds(
        setDoc(doc(authed("alice"), "users", "alice", "private", "profile"), {
          email: "alice@example.com",
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------
describe("groups/{gid}", () => {
  it("member reads group doc", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await assertSucceeds(getDoc(doc(authed("alice"), "groups", "g1")));
  });

  it("denies non-member reading group doc", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice", isPrivate: true });
    await assertFails(getDoc(doc(authed("eve"), "groups", "g1")));
  });

  it("creates a group with self as createdBy", async () => {
    await assertSucceeds(
      setDoc(doc(authed("alice"), "groups", "g1"), {
        name: "New Group",
        description: "",
        createdBy: "alice",
        founderUid: "alice",
        createdAt: serverTimestamp(),
        isPrivate: false,
        inviteCode: "abc123",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
      }),
    );
  });

  it("denies group create with inviteCode shorter than 6 chars", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1"), {
        name: "New Group",
        description: "",
        createdBy: "alice",
        createdAt: serverTimestamp(),
        isPrivate: false,
        inviteCode: "ab",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
      }),
    );
  });

  it("denies group create with unknown extra field", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1"), {
        name: "New Group",
        description: "",
        createdBy: "alice",
        createdAt: serverTimestamp(),
        isPrivate: false,
        inviteCode: "abc123",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
        hackedField: "evil",
      }),
    );
  });

  it("denies create with someone else as createdBy", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1"), {
        name: "New Group",
        createdBy: "bob",
        createdAt: serverTimestamp(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      }),
    );
  });

  it("denies create when memberCount != 1", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1"), {
        name: "New Group",
        createdBy: "alice",
        createdAt: serverTimestamp(),
        isPrivate: false,
        memberCount: 5,
        schemaVersion: 1,
      }),
    );
  });

  it("leader updates name and description", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "g1"), {
        name: "Renamed",
        description: "new desc",
      }),
    );
  });

  it("denies non-leader member updating name", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g1"), { name: "Hacked" }),
    );
  });

  it("denies leader updating disallowed fields like createdBy", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g1"), { createdBy: "eve" }),
    );
  });

  it("denies client deletion of group doc", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await assertFails(deleteDoc(doc(authed("alice"), "groups", "g1")));
  });

  // T20 — moderationPolicy is a backend-only field; the
  // /api/admin/groups/{gid}/moderation-policy endpoint writes it via the
  // Admin SDK. Clients (even leaders) must not be able to set it directly.
  it("denies leader writing moderationPolicy directly via the client", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g1"), {
        moderationPolicy: "lenient",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// members
// ---------------------------------------------------------------------------
describe("groups/{gid}/members/{uid}", () => {
  it("creator self-adds as leader after creating group", async () => {
    // Bootstrap path: group doc exists with createdBy=alice but no members yet.
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1"), {
        name: "g",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
    });
    await assertSucceeds(
      setDoc(doc(authed("alice"), "groups", "g1", "members", "alice"), {
        role: "leader",
        joinedAt: serverTimestamp(),
      }),
    );
  });

  it("denies non-creator from self-bootstrapping as leader", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1"), {
        name: "g",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
    });
    await assertFails(
      setDoc(doc(authed("eve"), "groups", "g1", "members", "eve"), {
        role: "leader",
        joinedAt: serverTimestamp(),
      }),
    );
  });

  it("leader adds another member", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await assertSucceeds(
      setDoc(doc(authed("alice"), "groups", "g1", "members", "bob"), {
        role: "member",
        joinedAt: serverTimestamp(),
      }),
    );
  });

  it("denies non-leader adding another member", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      setDoc(doc(authed("bob"), "groups", "g1", "members", "carol"), {
        role: "member",
        joinedAt: serverTimestamp(),
      }),
    );
  });

  it("user removes self from group", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertSucceeds(
      deleteDoc(doc(authed("bob"), "groups", "g1", "members", "bob")),
    );
  });

  it("leader removes another member", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertSucceeds(
      deleteDoc(doc(authed("alice"), "groups", "g1", "members", "bob")),
    );
  });

  it("denies non-leader removing someone else", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "members", "carol"), {
        role: "member",
        joinedAt: Timestamp.now(),
      });
    });
    await assertFails(
      deleteDoc(doc(authed("bob"), "groups", "g1", "members", "carol")),
    );
  });
});

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------
describe("groups/{gid}/messages/{mid}", () => {
  it("member creates a top-level message with own authorUid", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertSucceeds(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "hello",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("denies create when authorUid != auth.uid", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        authorUid: "alice",
        body: "spoofed",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("denies non-member creating a message", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await assertFails(
      setDoc(doc(authed("eve"), "groups", "g1", "messages", "m1"), {
        authorUid: "eve",
        body: "intruder",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("denies create with non-zero threadReplyCount", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "x",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 5,
        mediaRefs: [],
      }),
    );
  });

  it("thread reply with valid parentMessageId succeeds", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "parent"), {
        authorUid: "alice",
        body: "parent",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertSucceeds(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "reply1"), {
        authorUid: "bob",
        body: "reply",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: "parent",
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("denies thread reply when parent message doesn't exist", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "reply1"), {
        authorUid: "bob",
        body: "reply",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: "nonexistent",
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  // T20 — `moderation` is a system-only field maintained by onMessageCreate.
  // Clients may not set it on create or update.
  it("denies including a moderation field on create", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "hello",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
        moderation: { state: "scored", reasons: [], scores: {}, scoredAt: null },
      }),
    );
  });

  it("denies updating the moderation field after the fact", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "hi",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
        moderation: { state: "scored", reasons: [], scores: {}, scoredAt: null },
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        moderation: { state: "hidden", reasons: ["Toxic"], scores: {}, scoredAt: null },
      }),
    );
  });

  it("author edits own message body", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "original",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertSucceeds(
      updateDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        body: "edited",
        editedAt: serverTimestamp(),
      }),
    );
  });

  it("denies another member editing someone else's message", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "original",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g1", "messages", "m1"), {
        body: "tampered",
      }),
    );
  });

  it("denies author updating threadReplyCount via client", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "x",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        threadReplyCount: 7,
      }),
    );
  });

  it("denies hard-delete of message", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "x",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(
      deleteDoc(doc(authed("bob"), "groups", "g1", "messages", "m1")),
    );
  });

  it("denies undelete — setting deletedAt back to null (H4)", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "hello",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: Timestamp.now(), // already soft-deleted
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        deletedAt: null,
      }),
    );
  });

  it("denies non-member reading messages", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "alice",
        body: "private",
        createdAt: Timestamp.now(),
        parentMessageId: null,
        threadReplyCount: 0,
      });
    });
    await assertFails(
      getDoc(doc(authed("eve"), "groups", "g1", "messages", "m1")),
    );
  });
});

// ---------------------------------------------------------------------------
// stickers, moderation_queue, bans, audit_log
// ---------------------------------------------------------------------------
describe("stickers", () => {
  it("any authed user can read stickers", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "stickers", "s1"), {
        name: "Hallelujah",
        slug: "hallelujah",
        audience: "christian",
        order: 0,
      });
    });
    await assertSucceeds(getDoc(doc(authed("alice"), "stickers", "s1")));
  });

  it("denies any client write to stickers", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "stickers", "s1"), { name: "x" }),
    );
  });
});

describe("backend-only collections", () => {
  it("denies client read of moderation_queue", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "moderation_queue", "i1"), { status: "pending" });
    });
    await assertFails(
      getDoc(doc(authed("alice"), "moderation_queue", "i1")),
    );
  });

  it("denies client write of moderation_queue", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "moderation_queue", "i1"), {
        status: "pending",
      }),
    );
  });

  it("denies client read of bans", async () => {
    await seedBan("eve", new Date(Date.now() + 86_400_000));
    await assertFails(getDoc(doc(authed("eve"), "bans", "eve")));
  });

  it("denies client write of audit_log", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "audit_log", "e1"), { action: "x" }),
    );
  });

  it("denies client read of audit_log", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "audit_log", "e1"), {
        actorUid: "admin",
        action: "ban_user",
        targetRef: "users/alice",
      });
    });
    await assertFails(getDoc(doc(authed("alice"), "audit_log", "e1")));
  });

  it("denies unauthenticated read of audit_log", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "audit_log", "e1"), { actorUid: "admin", action: "x" });
    });
    await assertFails(getDoc(doc(anon(), "audit_log", "e1")));
  });
});

// ---------------------------------------------------------------------------
// banned users
// ---------------------------------------------------------------------------
describe("banned users", () => {
  it("denies banned user from creating a message", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seedBan("bob", new Date(Date.now() + 86_400_000));
    await assertFails(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "x",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("allows previously-banned user (expired) to write", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seedBan("bob", new Date(Date.now() - 86_400_000));
    await assertSucceeds(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "x",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  // M10 — expired-ban rule coverage gap
  it("expired ban: user can update their own user doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "bob"), {
        displayName: "Bob",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await seedBan("bob", new Date(Date.now() - 86_400_000));
    await assertSucceeds(
      updateDoc(doc(authed("bob"), "users", "bob"), {
        displayName: "Bob Renamed",
      }),
    );
  });

  it("expired ban: user can leave a group (delete own member doc)", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await seedBan("bob", new Date(Date.now() - 86_400_000));
    await assertSucceeds(
      deleteDoc(doc(authed("bob"), "groups", "g1", "members", "bob")),
    );
  });

  it("active ban that expires in the future still blocks writes", async () => {
    await seedGroup({
      gid: "g1",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    // Ban valid for 1 minute from now — must still block.
    await seedBan("bob", new Date(Date.now() + 60_000));
    await assertFails(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "x",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("denies banned user updating own user doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "bob"), {
        displayName: "Bob",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    await seedBan("bob", new Date(Date.now() + 86_400_000));
    await assertFails(
      updateDoc(doc(authed("bob"), "users", "bob"), {
        displayName: "Bob Renamed",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// default deny for unknown collections
// ---------------------------------------------------------------------------
describe("default deny", () => {
  it("denies access to an undeclared collection", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "made_up_collection", "x"), { v: 1 }),
    );
  });

  it("denies unauthenticated read of any document", async () => {
    await assertFails(getDoc(doc(anon(), "anything", "doc")));
  });
});

// ---------------------------------------------------------------------------
// T21: mute / block subcollections
// ---------------------------------------------------------------------------
describe("users/{uid}/mutes/{otherUid}", () => {
  it("owner can mute another user", async () => {
    await assertSucceeds(
      setDoc(doc(authed("alice"), "users", "alice", "mutes", "bob"), {
        mutedAt: serverTimestamp(),
      }),
    );
  });

  it("owner cannot mute themselves", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice", "mutes", "alice"), {
        mutedAt: serverTimestamp(),
      }),
    );
  });

  it("non-owner cannot read someone else's mute set", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice", "mutes", "bob"), {
        mutedAt: Timestamp.now(),
      });
    });
    await assertFails(
      getDoc(doc(authed("eve"), "users", "alice", "mutes", "bob")),
    );
  });

  it("non-owner cannot create mute on behalf of someone else", async () => {
    await assertFails(
      setDoc(doc(authed("eve"), "users", "alice", "mutes", "bob"), {
        mutedAt: serverTimestamp(),
      }),
    );
  });

  it("owner can unmute (delete)", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice", "mutes", "bob"), {
        mutedAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      deleteDoc(doc(authed("alice"), "users", "alice", "mutes", "bob")),
    );
  });

  it("rejects extra fields beyond mutedAt", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice", "mutes", "bob"), {
        mutedAt: serverTimestamp(),
        comment: "annoying",
      }),
    );
  });
});

describe("users/{uid}/blocks/{otherUid}", () => {
  it("owner can block another user", async () => {
    await assertSucceeds(
      setDoc(doc(authed("alice"), "users", "alice", "blocks", "bob"), {
        blockedAt: serverTimestamp(),
      }),
    );
  });

  it("owner cannot block themselves", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice", "blocks", "alice"), {
        blockedAt: serverTimestamp(),
      }),
    );
  });

  it("non-owner cannot read someone else's block set", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice", "blocks", "bob"), {
        blockedAt: Timestamp.now(),
      });
    });
    await assertFails(
      getDoc(doc(authed("eve"), "users", "alice", "blocks", "bob")),
    );
  });

  it("owner can unblock (delete)", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice", "blocks", "bob"), {
        blockedAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      deleteDoc(doc(authed("alice"), "users", "alice", "blocks", "bob")),
    );
  });
});

// ---------------------------------------------------------------------------
// M11: collection-group query for memberships
// ---------------------------------------------------------------------------
describe("members collectionGroup", () => {
  it("alice can list her own memberships across groups", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1"), {
        name: "g1",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", "g1", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
      await setDoc(doc(db, "groups", "g2"), {
        name: "g2",
        createdBy: "bob",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 2,
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", "g2", "members", "alice"), {
        role: "member",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
      await setDoc(doc(db, "groups", "g2", "members", "bob"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "bob",
      });
    });

    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(authed("alice"), "members"),
          where("uid", "==", "alice"),
        ),
      ),
    );
  });

  it("alice cannot enumerate bob's memberships via the same query shape", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1"), {
        name: "g1",
        createdBy: "bob",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", "g1", "members", "bob"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "bob",
      });
    });

    await assertFails(
      getDocs(
        query(
          collectionGroup(authed("alice"), "members"),
          where("uid", "==", "bob"),
        ),
      ),
    );
  });

  it("create rule rejects a member doc whose uid field disagrees with doc id", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1"), {
        name: "g1",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
    });
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g1", "members", "alice"), {
        role: "leader",
        joinedAt: serverTimestamp(),
        uid: "spoofed",
      }),
    );
  });

  it("create rule still accepts a member doc with matching uid field", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1"), {
        name: "g1",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
    });
    await assertSucceeds(
      setDoc(doc(authed("alice"), "groups", "g1", "members", "alice"), {
        role: "leader",
        joinedAt: serverTimestamp(),
        uid: "alice",
      }),
    );
  });
});
