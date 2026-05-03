/**
 * T32 — Firestore security rule tests for top-level message boards.
 *
 * Covers:
 *  - Board doc reads require sign-in; client cannot create/update/delete.
 *  - Posts: signed-in create requires ≥1 sticker, server time, archive guard.
 *  - Posts: anonymous denial; banned-user denial; sticker-missing denial.
 *  - Posts: author edits within 15 min; author or admin soft-delete.
 *  - Posts: non-author edit denied; admin pin/unpin allowed; non-admin denied.
 *  - Posts: client cannot write reactionCounts/replyCount directly.
 *  - Replies: same shape minus pinning; sticker optional.
 *  - Reactions: signed-in user can react; archived/deleted parent denies.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
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
    projectId: "demo-jacob-t32",
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

const authed = (uid: string, claims?: Record<string, unknown>): Firestore =>
  testEnv.authenticatedContext(uid, claims).firestore();
const anon = (): Firestore => testEnv.unauthenticatedContext().firestore();

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}

async function seedBoard(opts: { boardId: string; archived?: boolean }) {
  await seed(async (db) => {
    await setDoc(doc(db, "boards", opts.boardId), {
      name: "Prayer & Praise",
      slug: "prayer-praise",
      description: "Cross-group prayer requests",
      audience: "christian",
      createdAt: Timestamp.now(),
      archivedAt: opts.archived ? Timestamp.now() : null,
      postCount: 0,
      schemaVersion: 1,
    });
    await setDoc(doc(db, "stickers", "pray"), {
      slug: "pray",
      name: "Praying Hands",
      audience: "christian",
      order: 1,
    });
  });
}

const basePost = {
  authorUid: "alice",
  body: "Praying for you!",
  stickerIds: ["pray"],
  mediaRefs: [],
  createdAt: serverTimestamp(),
  editedAt: null,
  deletedAt: null,
  replyCount: 0,
  reactionCounts: {},
};

// ── board doc ────────────────────────────────────────────────────────────

describe("board doc rules", () => {
  it("signed-in user can read a board", async () => {
    await seedBoard({ boardId: "b1" });
    await assertSucceeds(
      (async () => {
        const { getDoc } = await import("firebase/firestore");
        return await getDoc(doc(authed("alice"), "boards", "b1"));
      })(),
    );
  });

  it("anonymous user cannot read a board", async () => {
    await seedBoard({ boardId: "b1" });
    await assertFails(
      (async () => {
        const { getDoc } = await import("firebase/firestore");
        return await getDoc(doc(anon(), "boards", "b1"));
      })(),
    );
  });

  it("client cannot create a board (admin-only)", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b-new"), {
        name: "New",
        slug: "new",
        description: "",
        audience: "general",
        createdAt: serverTimestamp(),
        archivedAt: null,
        postCount: 0,
        schemaVersion: 1,
      }),
    );
  });
});

// ── post create ──────────────────────────────────────────────────────────

describe("posts create", () => {
  it("signed-in user can create a post with sticker", async () => {
    await seedBoard({ boardId: "b1" });
    await assertSucceeds(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), basePost),
    );
  });

  it("anonymous user cannot create a post", async () => {
    await seedBoard({ boardId: "b1" });
    await assertFails(
      setDoc(doc(anon(), "boards", "b1", "posts", "p1"), {
        ...basePost,
        authorUid: "anon",
      }),
    );
  });

  it("post without a sticker is rejected", async () => {
    await seedBoard({ boardId: "b1" });
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        ...basePost,
        stickerIds: [],
      }),
    );
  });

  it("authorUid must match the caller", async () => {
    await seedBoard({ boardId: "b1" });
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        ...basePost,
        authorUid: "bob",
      }),
    );
  });

  it("non-empty reactionCounts on create is rejected", async () => {
    await seedBoard({ boardId: "b1" });
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        ...basePost,
        reactionCounts: { pray: 1 },
      }),
    );
  });

  it("archived board rejects creates", async () => {
    await seedBoard({ boardId: "b1", archived: true });
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), basePost),
    );
  });

  it("banned user cannot post", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "bans", "alice"), {
        reason: "abuse",
        bannedBy: "admin",
        expiresAt: Timestamp.fromMillis(Date.now() + 3_600_000),
      });
    });
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), basePost),
    );
  });

  it("body over 4000 chars is rejected", async () => {
    await seedBoard({ boardId: "b1" });
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        ...basePost,
        body: "x".repeat(4001),
      }),
    );
  });

  it("more than 4 mediaRefs is rejected", async () => {
    await seedBoard({ boardId: "b1" });
    await assertFails(
      setDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        ...basePost,
        mediaRefs: ["1", "2", "3", "4", "5"],
      }),
    );
  });
});

// ── post update ──────────────────────────────────────────────────────────

describe("posts update", () => {
  it("author can edit body within 15 minutes", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        body: "Updated body",
        editedAt: serverTimestamp(),
      }),
    );
  });

  it("non-author cannot edit body", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "boards", "b1", "posts", "p1"), {
        body: "Hijacked",
        editedAt: serverTimestamp(),
      }),
    );
  });

  it("author can soft-delete own post", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        deletedAt: serverTimestamp(),
      }),
    );
  });

  it("admin can soft-delete any post", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      updateDoc(
        doc(authed("modUid", { admin: true }), "boards", "b1", "posts", "p1"),
        { deletedAt: serverTimestamp() },
      ),
    );
  });

  it("admin can pin a post", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      updateDoc(
        doc(authed("modUid", { admin: true }), "boards", "b1", "posts", "p1"),
        {
          pinnedAt: serverTimestamp(),
          pinnedBy: "modUid",
        },
      ),
    );
  });

  it("non-admin cannot pin", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        pinnedAt: serverTimestamp(),
        pinnedBy: "alice",
      }),
    );
  });

  it("client cannot write reactionCounts directly", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        reactionCounts: { pray: 1 },
      }),
    );
  });

  it("client cannot increment replyCount directly", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "boards", "b1", "posts", "p1"), {
        replyCount: 1,
      }),
    );
  });
});

// ── replies ──────────────────────────────────────────────────────────────

describe("replies", () => {
  const baseReply = {
    authorUid: "bob",
    body: "Amen.",
    stickerIds: [],
    mediaRefs: [],
    createdAt: serverTimestamp(),
    editedAt: null,
    deletedAt: null,
  };

  it("signed-in user can reply (sticker optional)", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      setDoc(
        doc(authed("bob"), "boards", "b1", "posts", "p1", "replies", "r1"),
        baseReply,
      ),
    );
  });

  it("non-author cannot edit a reply", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
      await setDoc(doc(db, "boards", "b1", "posts", "p1", "replies", "r1"), {
        ...baseReply,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      updateDoc(
        doc(authed("alice"), "boards", "b1", "posts", "p1", "replies", "r1"),
        { body: "x", editedAt: serverTimestamp() },
      ),
    );
  });

  it("archived board denies replies", async () => {
    await seedBoard({ boardId: "b1", archived: true });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      setDoc(
        doc(authed("bob"), "boards", "b1", "posts", "p1", "replies", "r1"),
        baseReply,
      ),
    );
  });

  it("hard delete is not allowed (soft-delete only)", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
      await setDoc(doc(db, "boards", "b1", "posts", "p1", "replies", "r1"), {
        ...baseReply,
        createdAt: Timestamp.now(),
      });
    });
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(
      deleteDoc(
        doc(authed("bob"), "boards", "b1", "posts", "p1", "replies", "r1"),
      ),
    );
  });
});

// ── reactions ────────────────────────────────────────────────────────────

describe("post reactions", () => {
  it("signed-in user can react", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      setDoc(
        doc(
          authed("bob"),
          "boards",
          "b1",
          "posts",
          "p1",
          "reactions",
          "pray",
          "users",
          "bob",
        ),
        { reactedAt: serverTimestamp() },
      ),
    );
  });

  it("unknown sticker rejects reaction", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      setDoc(
        doc(
          authed("bob"),
          "boards",
          "b1",
          "posts",
          "p1",
          "reactions",
          "unknown",
          "users",
          "bob",
        ),
        { reactedAt: serverTimestamp() },
      ),
    );
  });

  it("archived board denies reactions", async () => {
    await seedBoard({ boardId: "b1", archived: true });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      setDoc(
        doc(
          authed("bob"),
          "boards",
          "b1",
          "posts",
          "p1",
          "reactions",
          "pray",
          "users",
          "bob",
        ),
        { reactedAt: serverTimestamp() },
      ),
    );
  });

  it("deleted post denies reactions", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
        deletedAt: Timestamp.now(),
      });
    });
    await assertFails(
      setDoc(
        doc(
          authed("bob"),
          "boards",
          "b1",
          "posts",
          "p1",
          "reactions",
          "pray",
          "users",
          "bob",
        ),
        { reactedAt: serverTimestamp() },
      ),
    );
  });

  it("user cannot write to another user's reaction doc", async () => {
    await seedBoard({ boardId: "b1" });
    await seed(async (db) => {
      await setDoc(doc(db, "boards", "b1", "posts", "p1"), {
        ...basePost,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(
      setDoc(
        doc(
          authed("bob"),
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
