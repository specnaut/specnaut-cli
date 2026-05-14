import { KNOWN_VERSION_SCHEMES, type VersionScheme } from "../domain/installed_lock.ts";
import { selectInteractive, type SelectIO } from "./select.ts";

export const DEFAULT_VERSION_SCHEME: VersionScheme = "semver";

export type SchemePickerIO = {
  readLine: () => string | null;
  log: (s: string) => void;
  errLog: (s: string) => void;
};

type SchemeMeta = {
  readonly key: VersionScheme;
  readonly displayName: string;
  readonly hint: string;
};

const SCHEME_CATALOG: ReadonlyArray<SchemeMeta> = [
  {
    key: "semver",
    displayName: "SemVer (v1.2.3)",
    hint: "best for libraries / SDKs with external consumers",
  },
  {
    key: "date",
    displayName: "Date-based (vYY.M.Da)",
    hint: "best for apps / SaaS — no MAJOR/MINOR/PATCH guesswork",
  },
];

if (SCHEME_CATALOG.length !== KNOWN_VERSION_SCHEMES.length) {
  throw new Error(
    "SCHEME_CATALOG and KNOWN_VERSION_SCHEMES are out of sync",
  );
}

/**
 * Non-interactive picker — for non-TTY contexts. Defaults to
 * `suggestion` on bare Enter, falls back to `DEFAULT_VERSION_SCHEME`
 * when no suggestion is supplied.
 */
export function pickVersionScheme(
  io: SchemePickerIO,
  suggestion: VersionScheme = DEFAULT_VERSION_SCHEME,
): VersionScheme {
  io.log("Choose your versioning scheme (press Enter for default):");
  for (let i = 0; i < SCHEME_CATALOG.length; i++) {
    const s = SCHEME_CATALOG[i];
    const marker = s.key === suggestion ? " (default)" : "";
    io.log(`  ${i + 1}) ${s.displayName} — ${s.hint}${marker}`);
  }
  while (true) {
    const raw = (io.readLine() ?? "").trim();
    if (raw === "") return suggestion;
    const idx = parseInt(raw, 10) - 1;
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < SCHEME_CATALOG.length
    ) {
      return SCHEME_CATALOG[idx].key;
    }
    io.errLog(
      `invalid choice "${raw}" — expected 1-${SCHEME_CATALOG.length} or empty for default`,
    );
  }
}

/**
 * Interactive arrow-key picker — for TTY contexts. The default cursor
 * lands on `suggestion`. Returns `null` on Ctrl-C / Esc.
 */
export async function pickVersionSchemeInteractive(
  io: SelectIO,
  suggestion: VersionScheme = DEFAULT_VERSION_SCHEME,
): Promise<VersionScheme | null> {
  const defaultIdx = SCHEME_CATALOG.findIndex((s) => s.key === suggestion);
  const items = SCHEME_CATALOG.map((s) => ({
    key: s.key,
    label: s.key === suggestion
      ? `${s.displayName} — ${s.hint} (suggested)`
      : `${s.displayName} — ${s.hint}`,
  }));
  return await selectInteractive(
    items,
    defaultIdx >= 0 ? defaultIdx : 0,
    io,
    "Choose your versioning scheme (↑/↓ to move, space/enter to select, Ctrl-C to cancel):",
  );
}
