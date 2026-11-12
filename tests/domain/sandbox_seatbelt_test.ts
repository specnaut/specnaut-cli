import { assert, assertEquals, assertThrows } from "@std/assert";
import { seatbeltProfile } from "../../src/domain/sandbox_seatbelt.ts";
import type { SandboxPolicy } from "../../src/domain/sandbox.ts";
import { ALLOWED_SERVICES, FORBIDDEN_SERVICES } from "../../src/domain/sandbox_hosts.ts";
import { PATHS, policyOf, SCRATCH_HOME, SCRATCH_TMP } from "./sandbox_fixture.ts";

/**
 * The `sandbox-exec` profile denies by default and allows only what the policy names. Its rules
 * are matched last-first, so the closing denies (network with loopback and unix sockets, launchd
 * jobs, the forbidden services) win over any allow above them.
 */

const profile = () => seatbeltProfile(policyOf("seatbelt"));
const lines = () => profile().split("\n");
const allowLines = () => lines().filter((l) => l.startsWith("(allow"));

Deno.test("seatbeltProfile: denies by default, first", () => {
  assertEquals(lines().slice(0, 2), ["(version 1)", "(deny default)"]);
  assert(!profile().includes("(allow default"));
});

Deno.test("seatbeltProfile: no network is allowed, loopback and unix sockets included", () => {
  assertEquals(allowLines().filter((l) => l.includes("network")), []);
  assert(lines().includes("(deny network*)"));
});

Deno.test("seatbeltProfile: the closing denies come after every allow", () => {
  const all = lines();
  const lastAllow = Math.max(...all.map((l, i) => (l.startsWith("(allow") ? i : -1)));
  for (const deny of ["(deny network*)", "(deny job-creation)"]) {
    assert(all.indexOf(deny) > lastAllow, deny);
  }
  const services = all.findIndex((l) => l.startsWith("(deny mach-lookup"));
  assert(services > lastAllow);
});

Deno.test("seatbeltProfile: each forbidden service is denied by name and never allowed", () => {
  const allows = allowLines().join("\n");
  const deny = lines().find((l) => l.startsWith("(deny mach-lookup")) ?? "";
  for (const service of Object.values(FORBIDDEN_SERVICES).flat()) {
    assert(!allows.includes(service), service);
    assert(deny.includes(`(global-name "${service}")`), service);
  }
});

Deno.test("seatbeltProfile: only the allowed services may be looked up", () => {
  const lookups = allowLines().filter((l) => l.includes("mach-lookup"));
  const names = ALLOWED_SERVICES.map((s) => `(global-name "${s}")`).join(" ");
  assertEquals(lookups, [`(allow mach-lookup ${names})`]);
});

Deno.test("seatbeltProfile: reads are the system, toolchain, tree and scratch folders only", () => {
  const policy = policyOf("seatbelt");
  const folders = [...policy.system, ...policy.reads, ...policy.writes];
  const read = allowLines().filter((l) => l.startsWith("(allow file-read* (subpath"));
  assertEquals(read, [`(allow file-read* ${folders.map((p) => `(subpath "${p}")`).join(" ")})`]);
});

Deno.test("seatbeltProfile: writes are the scratch folders and the devices only", () => {
  const writes = allowLines().filter((l) => l.includes("file-write"));
  assertEquals(writes, [
    `(allow file-read* file-write* ${
      policyOf("seatbelt").devices.map((d) => `(literal "${d}")`).join(" ")
    })`,
    `(allow file-write* (subpath "${SCRATCH_HOME}") (subpath "${SCRATCH_TMP}"))`,
  ]);
});

Deno.test("seatbeltProfile: the real home and the checkout appear in no rule", () => {
  const text = profile();
  assert(!text.includes(`"${PATHS.home}"`));
  assert(!text.includes(PATHS.checkout));
  assert(!text.includes('(subpath "/")'));
});

Deno.test("seatbeltProfile: other processes cannot be signalled or inspected", () => {
  const all = allowLines();
  assert(all.includes("(allow signal (target same-sandbox))"));
  assert(all.includes("(allow process-info* (target same-sandbox))"));
  assertEquals(all.filter((l) => l === "(allow signal)" || l === "(allow process-info*)"), []);
});

Deno.test("seatbeltProfile: a path that could break out of its quotes is refused", () => {
  const forged: SandboxPolicy = { ...policyOf("seatbelt"), reads: ['/a") (allow default) ("'] };
  assertThrows(() => seatbeltProfile(forged));
  assertThrows(() => seatbeltProfile({ ...policyOf("seatbelt"), writes: ["/a\\"] }));
});
