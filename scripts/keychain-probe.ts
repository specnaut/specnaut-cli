// The TypeScript half of the keychain probe (cli#662, US5): the SHIPPED
// `KeychainBackend` port, called directly, so the Go probe
// (cmd/keychain-probe) can be compared against what released binaries do.
//
// Never `KeychainCredentialStore`: its `load()` migrates a legacy
// `specflow-cloud` item forward, which would touch the real credential. The
// backend is called with a service name passed in — the Go driver owns it
// (`keychain-probe service`) — and the two real names are refused.
//
// Usage (compiled, as the CLI is):
//   deno compile --allow-ffi --allow-env --allow-read -o dist/keychain-probe-ts scripts/keychain-probe.ts
//   dist/keychain-probe-ts <reachable|write|read|remove|roundtrip> --service <name> [--account <name>]
// write/read/roundtrip read a per-run canary on stdin. Output is match /
// mismatch and a length, never a value.

import {
  KEYCHAIN_SERVICE,
  type KeychainBackend,
  type KeychainOutcome,
  LEGACY_KEYCHAIN_SERVICE,
} from "../src/infrastructure/keychain/keychain_backend.ts";
import { backendFactoryFor } from "../src/infrastructure/keychain/select.ts";

const REFUSED = [KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_SERVICE];
const MODES = ["reachable", "write", "read", "remove", "roundtrip"];

type Options = { mode: string; service: string; account: string };

/** Parses argv; a refusal is a message, never a default service. */
export function parseOptions(args: string[]): Options | string {
  const [mode, ...rest] = args;
  if (!MODES.includes(mode ?? "")) return `a mode is required: ${MODES.join("|")}`;
  const opts: Options = { mode, service: "", account: "probe" };
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (value === undefined) return `${rest[i]} needs a value`;
    if (rest[i] === "--service") opts.service = value;
    else if (rest[i] === "--account") opts.account = value;
    else return `unknown option ${rest[i]}`;
  }
  if (opts.service === "") return "--service is required (the Go driver prints it)";
  if (REFUSED.some((r) => r.toLowerCase() === opts.service.toLowerCase())) {
    return `refusing the real credential service "${opts.service}"`;
  }
  return opts;
}

function outcome(op: string, o: KeychainOutcome<unknown>): number {
  console.log(`${op}: ${o.kind}`);
  return o.kind === "unavailable" ? 1 : 0;
}

function compare(backend: KeychainBackend, o: Options, canary: string): number {
  const got = backend.get(o.service, o.account);
  if (got.kind !== "ok") return outcome("read", got) || 1;
  const verdict = got.value === canary ? "match" : "mismatch";
  console.log(`read: ${verdict} length=${got.value.length} (canary length=${canary.length})`);
  return verdict === "match" ? 0 : 1;
}

/** Runs one mode against `backend`. Exported for the unit test. */
export function probe(backend: KeychainBackend, o: Options, canary: string): number {
  switch (o.mode) {
    case "reachable":
      console.log(`reachable: ${backend.reachable()}`);
      return 0;
    case "remove":
      return outcome("remove", backend.remove(o.service, o.account));
    case "write":
      return outcome("write", backend.set(o.service, o.account, canary));
    case "read":
      return compare(backend, o, canary);
  }
  const wrote = outcome("write", backend.set(o.service, o.account, canary));
  if (wrote !== 0) return wrote;
  try {
    return compare(backend, o, canary);
  } finally {
    // Whatever the read said, the item does not outlive the probe.
    outcome("remove", backend.remove(o.service, o.account));
  }
}

async function readCanary(): Promise<string | null> {
  const text = (await new Response(Deno.stdin.readable).text()).replace(/\r?\n$/, "");
  return text.length >= 16 ? text : null;
}

async function main(): Promise<number> {
  const opts = parseOptions(Deno.args);
  if (typeof opts === "string") {
    console.error(`keychain-probe.ts: ${opts}`);
    return 2;
  }
  const factory = backendFactoryFor(Deno.build.os);
  if (factory === null) {
    console.log(`unsupported OS: ${Deno.build.os}`);
    return 1;
  }
  let canary = "";
  if (["write", "read", "roundtrip"].includes(opts.mode)) {
    const c = await readCanary();
    if (c === null) {
      console.error("keychain-probe.ts: the canary on stdin is shorter than 16 characters");
      return 2;
    }
    canary = c;
  }
  try {
    return probe(factory(), opts, canary);
  } catch (err) {
    // The class only: a backend message may echo what it was given.
    console.error(`keychain-probe.ts: backend error (${(err as Error).name})`);
    return 1;
  }
}

if (import.meta.main) Deno.exit(await main());
