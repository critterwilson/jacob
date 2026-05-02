/**
 * T22 — leader-hierarchy and leaderless-guard rules tests.
 *
 * The leader-count invariant is maintained by the onMemberWrite Cloud
 * Function (and a one-shot backfill script for legacy groups). The
 * tests below seed `groups/{gid}.leaderCount` directly and exercise
 * just the rule predicate.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  setDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-jacob-leaders",
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

async function seedGroupWithLeaders(opts: {
  gid: string;
  founderUid: string;
  leaders: string[];
  members?: string[];
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "Test Group",
      createdBy: opts.founderUid,
      founderUid: opts.founderUid,
      createdAt: Timestamp.now(),
      isPrivate: false,
      inviteCode: "INVITE01",
      memberCount: opts.leaders.length + (opts.members?.length ?? 0),
      stickerSet: "christian",
      schemaVersion: 1,
      leaderCount: opts.leaders.length,
    });
    for (const uid of opts.leaders) {
      await setDoc(doc(db, "groups", opts.gid, "members", uid), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid,
      });
    }
    for (const uid of opts.members ?? []) {
      await setDoc(doc(db, "groups", opts.gid, "members", uid), {
        role: "member",
        joinedAt: Timestamp.now(),
        uid,
      });
    }
  });
}

describe("T22 — leaderless guard", () => {
  it("the only leader cannot self-leave", async () => {
    await seedGroupWithLeaders({
      gid: "g1",
      founderUid: "alice",
      leaders: ["alice"],
    });
    await assertFails(
      deleteDoc(doc(authed("alice"), "groups", "g1", "members", "alice")),
    );
  });

  it("a leader can self-leave when another leader exists", async () => {
    await seedGroupWithLeaders({
      gid: "g2",
      founderUid: "alice",
      leaders: ["alice", "bob"],
    });
    await assertSucceeds(
      deleteDoc(doc(authed("bob"), "groups", "g2", "members", "bob")),
    );
  });

  it("a member (non-leader) can always self-leave", async () => {
    await seedGroupWithLeaders({
      gid: "g3",
      founderUid: "alice",
      leaders: ["alice"],
      members: ["bob"],
    });
    await assertSucceeds(
      deleteDoc(doc(authed("bob"), "groups", "g3", "members", "bob")),
    );
  });

  it("a leader can remove a member when they're the only leader", async () => {
    // The guard is on the *deleted* doc. When the only leader removes
    // a member (not themselves), role==member so the guard short-circuits.
    await seedGroupWithLeaders({
      gid: "g4",
      founderUid: "alice",
      leaders: ["alice"],
      members: ["bob"],
    });
    await assertSucceeds(
      deleteDoc(doc(authed("alice"), "groups", "g4", "members", "bob")),
    );
  });

  it("a leader cannot remove the last leader (themselves) from leaderCount path", async () => {
    await seedGroupWithLeaders({
      gid: "g5",
      founderUid: "alice",
      leaders: ["alice"],
    });
    await assertFails(
      deleteDoc(doc(authed("alice"), "groups", "g5", "members", "alice")),
    );
  });
});

describe("T22 — moderationPolicy / leaderCount / founderUid are system-only", () => {
  it("client cannot set leaderCount on group create", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "gx"), {
        name: "x",
        description: "",
        createdBy: "alice",
        founderUid: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "abc123",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
        leaderCount: 1, // not allowed
      }),
    );
  });

  it("client cannot create a group whose founderUid != createdBy", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "gy"), {
        name: "x",
        description: "",
        createdBy: "alice",
        founderUid: "eve",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "abc123",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
      }),
    );
  });

  it("leader cannot update founderUid via the client", async () => {
    await seedGroupWithLeaders({
      gid: "gz",
      founderUid: "alice",
      leaders: ["alice"],
    });
    await assertFails(
      setDoc(
        doc(authed("alice"), "groups", "gz"),
        { founderUid: "bob" },
        { merge: true },
      ),
    );
  });
});

describe("T22 — direct member role flips are denied", () => {
  it("a leader cannot promote/demote via a direct member-doc update", async () => {
    await seedGroupWithLeaders({
      gid: "gpd",
      founderUid: "alice",
      leaders: ["alice"],
      members: ["bob"],
    });
    await assertFails(
      setDoc(
        doc(authed("alice"), "groups", "gpd", "members", "bob"),
        { role: "leader" },
        { merge: true },
      ),
    );
  });
});
