"use client";

import Link from "next/link";

import { Card } from "@/components/ui";
import type { Board } from "@/lib/hooks/useBoards";

type Props = {
  board: Board;
};

export function BoardCard({ board }: Props) {
  return (
    <Link
      href={`/boards/${board.boardId}`}
      className="block rounded-lg focus:outline-none focus-visible:shadow-glow-gold"
    >
      <Card surface="raised" interactive padding="md">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-body font-medium text-cream">{board.name}</h3>
            {board.description && (
              <p className="mt-1 line-clamp-2 text-body-sm text-cream-muted">
                {board.description}
              </p>
            )}
          </div>
          <span className="shrink-0 whitespace-nowrap text-caption text-cream-muted">
            {board.postCount} {board.postCount === 1 ? "post" : "posts"}
          </span>
        </div>
      </Card>
    </Link>
  );
}
