import { RELEASE_REPO, SemVer } from "./release.ts";

/**
 * The highlights every release published, one entry per release, its version
 * without the `v` ("9.1.0"). Embedded in the binary at bundle time from
 * `.specnaut/release/history/`, which is where the bundler checks what it may
 * contain (cli#759): nothing here sanitises it.
 */
export type ReleaseHistory = ReadonlyArray<{ readonly version: string; readonly content: string }>;

export type CrossedRelease = {
  readonly version: string;
  /** The release's highlights as published, or `null` when it published none. */
  readonly highlights: string | null;
  readonly url: string;
};

export type ReleaseNotes =
  | { readonly kind: "no-change" }
  | {
    readonly kind: "crossed";
    readonly releases: ReadonlyArray<CrossedRelease>;
    /**
     * The oldest release the history records, when the range starts before it:
     * the releases older than it published no highlights, and are said once
     * rather than listed, since the history is the only list of releases there is.
     */
    readonly recordedSince: string | null;
  }
  /** No range to walk: a downgrade, or a version that is not SemVer. */
  | { readonly kind: "none" };

/**
 * The page of one release's full notes. Built from `RELEASE_REPO`, never
 * stored: the repository has one spelling, and a stored link is a second.
 */
export function releaseUrl(version: SemVer): string {
  return `https://github.com/${RELEASE_REPO}/releases/tag/v${version}`;
}

/**
 * The releases an upgrade from `from` to `to` crossed: every history entry in
 * (from, to], in SemVer order. A release with no entry is not invented — the
 * history is the list. Never throws: the notes must not decide an upgrade's
 * outcome, so a version that does not parse yields `none`.
 */
export function crossedReleases(from: string, to: string, history: ReleaseHistory): ReleaseNotes {
  const a = SemVer.tryParse(from);
  const b = SemVer.tryParse(to);
  if (a === null || b === null) return { kind: "none" };
  const order = a.compare(b);
  if (order === 0) return { kind: "no-change" };
  if (order > 0) return { kind: "none" };
  const recorded = history
    .map((e) => ({ version: SemVer.tryParse(e.version), text: e.content }))
    .filter((e): e is { version: SemVer; text: string } => e.version !== null)
    .sort((x, y) => x.version.compare(y.version));
  const oldest = recorded[0]?.version;
  return {
    kind: "crossed",
    releases: recorded
      .filter((e) => e.version.compare(a) > 0 && e.version.compare(b) <= 0)
      .map((e) => ({
        version: e.version.toString(),
        highlights: e.text.trim() === "" ? null : e.text,
        url: releaseUrl(e.version),
      })),
    recordedSince: oldest !== undefined && a.compare(oldest) < 0 ? oldest.toString() : null,
  };
}
