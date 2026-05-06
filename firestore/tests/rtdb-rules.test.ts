// RTDB security-rules tests for `infra/firebase-rtdb-rules.json`.
//
// Covers M5 from the codebase review: presence, typing, and watch-session
// rules. The watch suite explicitly regresses C7 — confirming a non-leader
// member cannot spoof `leaderUid` to take over a synchronized playback
// session.
//
// These tests run against the RTDB emulator. CI starts both Firestore and
// the database emulator via `firebase emulators:exec --only firestore,database`.

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
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
    database: {
      rules: readFileSync(
        resolve(__dirname, "../../infra/firebase-rtdb-rules.json"),
        "utf8",
      ),
      host: "127.0.0.1",
      port: 9000,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearDatabase();
});

const authedDb = (uid: string) =>
  testEnv.authenticatedContext(uid).database();

async function seedMembership(gid: string, uid: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref(`memberships/${uid}/${gid}`).set(true);
  });
}

async function seedWatchSession(
  gid: string,
  sessionId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref(`watch/${gid}/${sessionId}`).set(payload);
  });
}

describe("M5 RTDB — presence", () => {
  it("member can write own presence node", async () => {
    await seedMembership("g1", "alice");
    await assertSucceeds(
      authedDb("alice")
        .ref("presence/g1/alice")
        .set({ lastSeenAt: Date.now(), status: "online" }),
    );
  });

  it("member cannot write another user's presence node", async () => {
    await seedMembership("g1", "alice");
    await seedMembership("g1", "bob");
    await assertFails(
      authedDb("alice")
        .ref("presence/g1/bob")
        .set({ lastSeenAt: Date.now(), status: "online" }),
    );
  });

  it("non-member cannot read or write presence", async () => {
    await seedMembership("g1", "alice");
    await assertFails(authedDb("bob").ref("presence/g1").once("value"));
    await assertFails(
      authedDb("bob")
        .ref("presence/g1/bob")
        .set({ lastSeenAt: Date.now(), status: "online" }),
    );
  });

  it("rejects malformed payload", async () => {
    await seedMembership("g1", "alice");
    await assertFails(
      authedDb("alice")
        .ref("presence/g1/alice")
        .set({ status: "online" }), // missing lastSeenAt
    );
    await assertFails(
      authedDb("alice")
        .ref("presence/g1/alice")
        .set({ lastSeenAt: Date.now(), status: "weird" }),
    );
  });
});

describe("M5 RTDB — typing", () => {
  it("member can write own typing node", async () => {
    await seedMembership("g1", "alice");
    await assertSucceeds(
      authedDb("alice")
        .ref("typing/g1/alice")
        .set({ startedAt: Date.now() }),
    );
  });

  it("member cannot write another user's typing node", async () => {
    await seedMembership("g1", "alice");
    await seedMembership("g1", "bob");
    await assertFails(
      authedDb("alice")
        .ref("typing/g1/bob")
        .set({ startedAt: Date.now() }),
    );
  });
});

describe("M5 RTDB — watch sessions (C7 regression)", () => {
  const validSession = (leaderUid: string) => ({
    videoId: "abc12345",
    paused: false,
    positionSec: 0,
    leaderUid,
    updatedAt: Date.now(),
  });

  it("member can create a session as themselves (no existing data)", async () => {
    await seedMembership("g1", "alice");
    await assertSucceeds(
      authedDb("alice").ref("watch/g1/s1").set(validSession("alice")),
    );
  });

  it("leader can update an existing session", async () => {
    await seedMembership("g1", "alice");
    await seedWatchSession("g1", "s1", validSession("alice"));
    await assertSucceeds(
      authedDb("alice")
        .ref("watch/g1/s1")
        .set({ ...validSession("alice"), positionSec: 42 }),
    );
  });

  // C7: a non-leader member must not be able to overwrite the session and
  // claim the leader slot. Before the fix this passed because validate only
  // required `newData.leaderUid == auth.uid`, and any member's write was
  // allowed by .write.
  it("non-leader cannot overwrite the session and become leader (C7)", async () => {
    await seedMembership("g1", "alice");
    await seedMembership("g1", "bob");
    await seedWatchSession("g1", "s1", validSession("alice"));
    await assertFails(
      authedDb("bob").ref("watch/g1/s1").set(validSession("bob")),
    );
  });

  it("non-leader cannot mutate a single field (positionSec) on an existing session", async () => {
    await seedMembership("g1", "alice");
    await seedMembership("g1", "bob");
    await seedWatchSession("g1", "s1", validSession("alice"));
    await assertFails(
      authedDb("bob").ref("watch/g1/s1/positionSec").set(99),
    );
  });

  it("leader cannot transfer leaderUid to another user via client (must go through API)", async () => {
    await seedMembership("g1", "alice");
    await seedMembership("g1", "bob");
    await seedWatchSession("g1", "s1", validSession("alice"));
    await assertFails(
      authedDb("alice")
        .ref("watch/g1/s1")
        .set({ ...validSession("alice"), leaderUid: "bob" }),
    );
  });

  it("non-member cannot read the session", async () => {
    await seedMembership("g1", "alice");
    await seedWatchSession("g1", "s1", validSession("alice"));
    await assertFails(authedDb("eve").ref("watch/g1/s1").once("value"));
  });

  it("member can read the session", async () => {
    await seedMembership("g1", "alice");
    await seedMembership("g1", "bob");
    await seedWatchSession("g1", "s1", validSession("alice"));
    await assertSucceeds(authedDb("bob").ref("watch/g1/s1").once("value"));
  });

  it("leader can delete (end) the session", async () => {
    await seedMembership("g1", "alice");
    await seedWatchSession("g1", "s1", validSession("alice"));
    await assertSucceeds(
      authedDb("alice").ref("watch/g1/s1").set(null),
    );
  });

  it("non-leader cannot delete the session", async () => {
    await seedMembership("g1", "alice");
    await seedMembership("g1", "bob");
    await seedWatchSession("g1", "s1", validSession("alice"));
    await assertFails(authedDb("bob").ref("watch/g1/s1").set(null));
  });
});
