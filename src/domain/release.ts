export type Asset = {
  name: string;
  url: string;
};

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export class SemVer {
  constructor(
    readonly major: number,
    readonly minor: number,
    readonly patch: number,
    readonly prerelease: string | null,
  ) {}

  static parse(raw: string): SemVer {
    const m = SEMVER_RE.exec(raw.trim());
    if (!m) throw new Error(`Invalid semver: ${raw}`);
    return new SemVer(Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null);
  }

  compare(other: SemVer): -1 | 0 | 1 {
    for (
      const [a, b] of [
        [this.major, other.major],
        [this.minor, other.minor],
        [this.patch, other.patch],
      ]
    ) {
      if (a < b) return -1;
      if (a > b) return 1;
    }
    if (this.prerelease === other.prerelease) return 0;
    if (this.prerelease === null) return 1; // release > prerelease
    if (other.prerelease === null) return -1;
    return this.prerelease < other.prerelease ? -1 : 1;
  }

  isNewerThan(other: SemVer): boolean {
    return this.compare(other) === 1;
  }

  toString(): string {
    const base = `${this.major}.${this.minor}.${this.patch}`;
    return this.prerelease ? `${base}-${this.prerelease}` : base;
  }
}

export class Release {
  constructor(
    readonly version: SemVer,
    readonly assets: ReadonlyArray<Asset>,
  ) {}

  assetFor(triple: string): Asset | null {
    const match = this.assets.find(
      (a) => a.name.includes(triple) && !a.name.endsWith(".sha256"),
    );
    return match ?? null;
  }

  checksumAssetFor(triple: string): Asset | null {
    const match = this.assets.find(
      (a) => a.name.includes(triple) && a.name.endsWith(".sha256"),
    );
    return match ?? null;
  }
}
