"use client";

import Link from "next/link";

import type { Board } from "@/lib/hooks/useBoards";

type Props = {
  board: Board;
};

export function BoardCard({ board }: Props) {
  return (
    <Link
      href={`/boards/${board.boardId}`}
      className="block rounded border border-gray-200 p-4 transition-colors hover:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium text-gray-900">{board.name}</h3>
          {board.description && (
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">
              {board.description}
            </p>
          )}
        </div>
        <span className="whitespace-nowrap text-xs text-gray-400">
          {board.postCount} {board.postCount === 1 ? "post" : "posts"}
        </span>
      </div>
    </Link>
  );
}
