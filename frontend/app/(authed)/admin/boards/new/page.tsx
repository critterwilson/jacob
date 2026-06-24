"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  BoardForm,
  type BoardSubmitValues,
} from "@/components/admin/boards/BoardForm";
import { Eyebrow, Heading, Link } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { BRAND_NAME } from "@/lib/brand";

type Board = {
  boardId: string;
  name: string;
  slug: string;
  description: string;
  audience: "christian" | "general";
  archivedAt: string | null;
  postCount: number;
};

export default function NewBoardPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (payload: BoardSubmitValues) => {
    if (payload.mode !== "create") return;
    setPending(true);
    setError(null);
    try {
      await apiPost<Board>("/api/admin/boards", payload.values);
      router.push("/admin/boards");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message || `Failed to create board (HTTP ${e.status}).`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Failed to create board.");
      }
      setPending(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6">
      <Link href="/admin/boards" variant="muted" className="text-caption">
        ← Boards
      </Link>

      <header className="space-y-1">
        <Eyebrow>Admin</Eyebrow>
        <Heading level={1} size="md">
          New board
        </Heading>
        <p className="text-body-sm text-cream-muted">
          {`A cross-group forum anyone in ${BRAND_NAME} can read and post to.`}
        </p>
      </header>

      <BoardForm
        mode="create"
        pending={pending}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/admin/boards")}
      />
    </main>
  );
}
