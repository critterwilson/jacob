/**
 * MessageRef — abstracts a reactable / mentionable parent doc path
 * across the two hosts T26/T27 + T32 share:
 *   - group chat: groups/{gid}/messages/{mid}
 *   - board post: boards/{boardId}/posts/{postId}
 *
 * Components that render reactions or mention text accept this type
 * and dispatch to the right collection.
 */

export type GroupMessageRef = {
  kind: "group_message";
  gid: string;
  mid: string;
};

export type BoardPostRef = {
  kind: "board_post";
  boardId: string;
  postId: string;
};

export type MessageRef = GroupMessageRef | BoardPostRef;

export function reactionPath(ref: MessageRef, slug: string, uid: string): string[] {
  if (ref.kind === "group_message") {
    return [
      "groups",
      ref.gid,
      "messages",
      ref.mid,
      "reactions",
      slug,
      "users",
      uid,
    ];
  }
  return [
    "boards",
    ref.boardId,
    "posts",
    ref.postId,
    "reactions",
    slug,
    "users",
    uid,
  ];
}

export function refToString(ref: MessageRef): string {
  if (ref.kind === "group_message") {
    return `groups/${ref.gid}/messages/${ref.mid}`;
  }
  return `boards/${ref.boardId}/posts/${ref.postId}`;
}
