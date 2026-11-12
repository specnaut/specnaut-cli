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
 * history is the list.
 *
 * Prereleases are crossed only on the way to a prerelease (cli#775): a stable
 * release's own record already says what its candidates shipped, so listing
 * them would repeat it under names the user never installed, while a user who
 * opted into a prerelease follows the candidates and wants each one.
 *
 * Never throws on `from` or `to`: the notes must not decide an upgrade's
 * outcome, so a version that does not parse yields `none`. A history entry that
 * does not parse does throw — the bundler owns the name rule and refuses such a
 * file, so one reaching here is a broken bundle, never a shorter list.
 */
export function crossedReleases(from: string, to: string, history: ReleaseHistory): ReleaseNotes {
  const parsed = history.map((e) => {
    const version = SemVer.tryParse(e.version);
    if (version === null) throw new Error(`Release history entry "${e.version}" is not SemVer`);
    return { version, text: e.content };
  });
  const a = SemVer.tryParse(from);
  const b = SemVer.tryParse(to);
  if (a === null || b === null) return { kind: "none" };
  const order = a.compare(b);
  if (order === 0) return { kind: "no-change" };
  if (order > 0) return { kind: "none" };
  const recorded = parsed
    .filter((e) => b.prerelease !== null || e.version.prerelease === null)
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
