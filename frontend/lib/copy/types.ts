// Shared types for the audience-keyed copy module (T56).
// `CopyMap` is intentionally a string→string map (not a const enum) so a
// variant can override only a subset of keys without forcing every
// variant to ship the entire string table.

export type CopyMap = Record<string, string>;

export type Audience = "christian" | "general";
