import { assertEquals, assertThrows } from "@std/assert";
import { parseOptions, probe } from "../../scripts/keychain-probe.ts";
import type { KeychainBackend } from "../../src/infrastructure/keychain/keychain_backend.ts";

/**
 * cli#662 — the TypeScript keychain probe touches only the service it is given,
 * refuses the CLI's own, and leaves nothing behind.
 */

function memBackend(
  items = new Map<string, string>(),
): KeychainBackend & { items: Map<string, string> } {
  const k = (s: string, a: string) => `${s}\u0000${a}`;
  return {
    platform: "linux",
    items,
    get: (s, a) =>
      items.has(k(s, a)) ? { kind: "ok", value: items.get(k(s, a))! } : { kind: "miss" },
    set: (s, a, v) => (items.set(k(s, a), v), { kind: "ok", value: undefined }),
    remove: (s, a) => (items.delete(k(s, a)), { kind: "ok", value: undefined }),
    reachable: () => true,
  };
}

const CANARY = "c4n4ry-0123456789abcdef";

Deno.test("the probe refuses the real service names and requires one", () => {
  for (const s of ["specnaut-cloud", "Specflow-Cloud"]) {
    assertEquals(typeof parseOptions(["write", "--service", s]), "string", `${s} accepted`);
  }
  assertEquals(typeof parseOptions(["write"]), "string", "no --service, yet accepted");
  assertEquals(parseOptions(["read", "--service", "specnaut-keychain-probe"]), {
    mode: "read",
    service: "specnaut-keychain-probe",
    account: "probe",
  });
});

Deno.test("roundtrip matches and removes its item", () => {
  const b = memBackend();
  const code = probe(
    b,
    { mode: "roundtrip", service: "specnaut-keychain-probe", account: "p" },
    CANARY,
  );
  assertEquals(code, 0);
  assertEquals(b.items.size, 0, "roundtrip left an item behind");
});

Deno.test("roundtrip removes its item even when the read throws", () => {
  const b = memBackend();
  const throwing = {
    ...b,
    get: () => {
      throw new Error("boom");
    },
  };
  assertThrows(() =>
    probe(throwing, { mode: "roundtrip", service: "specnaut-keychain-probe", account: "p" }, CANARY)
  );
  assertEquals(b.items.size, 0);
});

Deno.test("roundtrip removes its item even when the write throws after storing it", () => {
  const b = memBackend();
  const throwing = {
    ...b,
    set: (s: string, a: string, v: string) => {
      b.set(s, a, v);
      throw new Error("timeout");
    },
  };
  assertThrows(() =>
    probe(throwing, { mode: "roundtrip", service: "specnaut-keychain-probe", account: "p" }, CANARY)
  );
  assertEquals(b.items.size, 0, "a write that stored and then threw left its item");
});

/** Runs `f` with console.log captured; returns what it printed and returned. */
function captured(f: () => number): { code: number; out: string } {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    return { code: f(), out: lines.join("\n") };
  } finally {
    console.log = log;
  }
}

Deno.test("a read of a differently-encoded item says mismatch, by length only, and fails", () => {
  const b = memBackend();
  const encoding = { ...b, set: (s: string, a: string, v: string) => b.set(s, a, `x:${v}`) };
  const o = { mode: "roundtrip", service: "specnaut-keychain-probe", account: "p" };
  const { code, out } = captured(() => probe(encoding, o, CANARY));
  assertEquals(code, 1);
  assertEquals(out.includes("read: mismatch\n"), true, out);
  assertEquals(out.includes(CANARY), false, "the canary was printed");
  assertEquals(b.items.size, 0, "the mismatching roundtrip left its item");
  const read = captured(() => probe(encoding, { ...o, mode: "read" }, CANARY));
  assertEquals(read.code, 1, "a read of an absent item passed");
});

/**
 * The matrix script's cleanup, driven with stand-in probes that log every
 * removal. `killAt` makes the TS stand-in send SIGTERM to the script during
 * that mode, as a cancelled job would.
 */
async function matrixRemovals(killAt: string): Promise<string[]> {
  const dir = await Deno.makeTempDir({ prefix: "probe-matrix-" });
  try {
    const fake = (name: string) =>
      `#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\n` +
      `if [ "$1" = service ]; then echo svc; exit 0; fi\n` +
      `if [ "$1" = remove ]; then echo "${name} $*" >> "${dir}/removed"; fi\n` +
      `if [ "${name}" = ts ] && [ "$1" = "${killAt}" ]; then kill -TERM "$PPID"; sleep 1; fi\n`;
    for (const name of ["go", "ts"]) {
      await Deno.writeTextFile(`${dir}/${name}`, fake(name));
      await Deno.chmod(`${dir}/${name}`, 0o755);
    }
    await new Deno.Command("bash", {
      args: [
        new URL("../../scripts/keychain-probe-matrix.sh", import.meta.url).pathname,
        `${dir}/go`,
        `${dir}/ts`,
      ],
      stdout: "null",
      stderr: "null",
    }).output();
    const log = await Deno.readTextFile(`${dir}/removed`).catch((err) => {
      if (err instanceof Deno.errors.NotFound) return "";
      throw err;
    });
    return log.split("\n").filter(Boolean).map((l) =>
      l.replace(/^(\w+) remove .*--account (\S+).*$/, "$1:$2")
    )
      .filter((l) => !l.includes(" ")).sort();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const EVERY_ACCOUNT = ["go:go-rt", "go:go-wrote", "ts:ts-rt", "ts:ts-wrote"];

// The stand-ins are bash scripts addressed by POSIX paths and the kill case
// signals the script's PID; neither holds under Windows' Git Bash, where the
// suite also runs (CI cross-smoke). The cleanup itself is bash's EXIT trap,
// identical on every OS the dry run uses.
const POSIX_ONLY = Deno.build.os === "windows";

Deno.test({
  name: "the matrix script removes every probe account when it ends",
  ignore: POSIX_ONLY,
  async fn() {
    assertEquals([...new Set(await matrixRemovals("none"))], EVERY_ACCOUNT);
  },
});

Deno.test({
  name: "the matrix script removes every probe account when it is killed mid-roundtrip",
  ignore: POSIX_ONLY,
  async fn() {
    assertEquals([...new Set(await matrixRemovals("roundtrip"))], EVERY_ACCOUNT);
  },
});
