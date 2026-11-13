import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ALLOWED_SERVICES, FORBIDDEN_SERVICES } from "../../src/domain/sandbox_hosts.ts";
import { tempDir } from "../helpers/git_fixture.ts";
import { live, NO_PERL, probed } from "../infrastructure/sandbox_live_fixture.ts";
import {
  assertRefused,
  EPERM,
  probeInside,
  probeOnHost,
  withIsolation,
} from "./isolation_world.ts";

/**
 * On macOS, `sandbox-exec` shares the host's network stack and its session's services, so each is
 * tried from inside a run: loopback over TCP and a unix socket, a lookup of every service the
 * policy forbids, and a launchd job. Each fails inside and succeeds with the same probe on the host;
 * a lookup the policy allows succeeds inside too, so a probe that never worked cannot pass. The
 * lookups go through a small program the branch carries, built here with the developer tools.
 */

/** The branch's lookup program: `ok`, or `fail <code>` with the bootstrap server's answer. */
const LOOKUP_C = `#include <stdio.h>
#include <servers/bootstrap.h>
int main(int argc, char **argv) {
  mach_port_t port;
  kern_return_t kr = bootstrap_look_up(bootstrap_port, argv[1], &port);
  if (kr == KERN_SUCCESS) printf("ok\\n"); else printf("fail %d\\n", kr);
  return 0;
}
`;

/** What the bootstrap server answers a lookup the sandbox refuses, and one of no such service. */
const REFUSED = "fail 1100";
const UNKNOWN = "fail 1102";

function developerTools(): boolean {
  if (Deno.build.os !== "darwin") return false;
  const select = new Deno.Command("/usr/bin/xcode-select", { args: ["-p"], stderr: "null" });
  return select.outputSync().code === 0;
}

const MISSING = !probed.sandboxExec
  ? "macOS with sandbox-exec"
  : !developerTools()
  ? "the developer tools, to build the lookup program"
  : NO_PERL;

async function lookupProgram(): Promise<Uint8Array> {
  const dir = await tempDir("specnaut-lookup-");
  try {
    await Deno.writeTextFile(join(dir, "lookup.c"), LOOKUP_C);
    const cc = new Deno.Command("/usr/bin/cc", { args: ["-o", "lookup", "lookup.c"], cwd: dir });
    const { code, stderr } = await cc.output();
    assertEquals(code, 0, new TextDecoder().decode(stderr));
    return await Deno.readFile(join(dir, "lookup"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** `launchctl <verb> <label>` succeeded: launchd holds the job (`list`), or removed it. */
function launchd(verb: "list" | "remove", label: string): boolean {
  const run = new Deno.Command("/bin/launchctl", {
    args: [verb, label],
    stdout: "null",
    stderr: "null",
  });
  return run.outputSync().code === 0;
}

/** Whether launchd lets go of `label` within a few seconds: `remove` returns before it is gone. */
async function removed(label: string): Promise<boolean> {
  for (const until = Date.now() + 5_000; Date.now() < until;) {
    if (!launchd("list", label)) return true;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return false;
}

const FORBIDDEN: readonly string[] = Object.values(FORBIDDEN_SERVICES).flat();

/** Every attempt, the launchd job under `label`: the same words inside and on the host. */
function attempts(label: string): string[] {
  const services = [...FORBIDDEN, ...ALLOWED_SERVICES].map((s) => `lookup=${s}`);
  return [...services, "loopback=tcp", "loopback=unix", `job=${label}`];
}

/** Inside: every forbidden lookup refused by the sandbox, the allowed one found, the rest failed. */
function assertRefusedInside(inside: Map<string, string>, label: string): void {
  for (const s of FORBIDDEN) assertEquals(inside.get(`lookup ${s}`), REFUSED, s);
  for (const s of ALLOWED_SERVICES) assertEquals(inside.get(`lookup ${s}`), "ok", s);
  assertRefused(inside.get("loopback tcp"), "loopback tcp", [EPERM]);
  assertRefused(inside.get("loopback unix"), "loopback unix", [EPERM]);
  assertRefused(inside.get(`job ${label}`), "job");
  assert(!launchd("list", label), "the run submitted a launchd job");
}

/**
 * On the host: each forbidden service found, but for one this macOS does not register, which
 * cannot be found anywhere; loopback and the job succeed.
 */
function assertGrantedOnHost(host: Map<string, string>, label: string): void {
  const found = FORBIDDEN.filter((s) => host.get(`lookup ${s}`) === "ok");
  for (const s of FORBIDDEN.filter((s) => !found.includes(s))) {
    assertEquals(host.get(`lookup ${s}`), UNKNOWN, s);
  }
  assert(found.length > 0, "the lookup program found no forbidden service on the host");
  for (const s of ALLOWED_SERVICES) assertEquals(host.get(`lookup ${s}`), "ok", s);
  assertEquals(host.get("loopback tcp"), "ok");
  assertEquals(host.get("loopback unix"), "ok");
  assertEquals(host.get(`job ${label}`), "ok");
}

Deno.test({
  name: live(
    "isolation live: on seatbelt, loopback, each forbidden service and a launchd job fail inside",
    MISSING,
  ),
  ignore: MISSING !== null,
  fn: async () => {
    const lookup = await lookupProgram();
    await withIsolation(async (iso) => {
      const label = `specnaut.probe.${iso.nonce}`;
      try {
        assertRefusedInside(await probeInside("seatbelt", iso, attempts(label)), label);
        assertGrantedOnHost(await probeOnHost(iso, attempts(label)), label);
      } finally {
        launchd("remove", label);
      }
      assert(await removed(label), "the host control's launchd job outlived the test");
    }, lookup);
  },
});
