import type { Repo, RepoOptions } from "./gate_impact_fixture.ts";

/**
 * The one corpus every twin answers (SC-002, SC-003, SC-004): a change on a feature
 * branch of a synthetic repository, and what must be selected for it. `build` returns
 * the flags when they are not the plain `fast --base <main>`.
 */

export type Invocation = { args?: string[]; stdin?: string };

export type Case = {
  name: string;
  repo?: RepoOptions;
  build: (r: Repo) => Promise<Invocation | void>;
  code: number;
  scope?: string;
  /** What the fallback line starts with, when the run widened. */
  fallback?: string;
  /** What must have run: `<marker> <owners>`, or `unset` for a command given none. */
  marks: string[];
  /** The `removed:` lines, when a base's tier held more. */
  removed?: string[];
  /** Plants something a Windows checkout cannot hold without privileges. */
  posixOnly?: boolean;
};

export const FULL_MARKS = ["suite unset", "web-only unset", "always unset"];

/** What the default gates run for these affected owners: the ground truth of SC-002. */
export const scoped = (...owners: string[]) => [
  `suite-scoped ${owners.join(" ")}`,
  ...(owners.includes("web") ? ["web-scoped web"] : []),
  "always unset",
];

export const change = (path: string) => async (r: Repo) => {
  await r.commit({ [path]: "changed\n" });
};
