import { assert, assertEquals } from "@std/assert";
import { type SandboxPaths, sandboxPolicy } from "../../src/domain/sandbox.ts";
import { LIMITS } from "../../src/domain/sandbox_limits.ts";
import {
  ALLOWED_SERVICES,
  FORBIDDEN_SERVICES,
  SEATBELT_SYSCTLS,
} from "../../src/domain/sandbox_hosts.ts";
import { bwrapArgs, containerArgs } from "../../src/domain/sandbox_args.ts";
import { seatbeltProfile } from "../../src/domain/sandbox_seatbelt.ts";
import { PATHS, policyOf, SCRATCH_HOME, SCRATCH_TMP } from "./sandbox_fixture.ts";

/**
 * What a sandboxed gate may touch: a fixed environment, system and toolchain folders and the
 * exported tree read-only, two empty scratch folders written, no network, capped resources. The
 * real home and the user's checkout are never visible.
 */

function refusal(over: Partial<SandboxPaths>, backend: "bwrap" | "seatbelt" = "bwrap"): string {
  const result = sandboxPolicy(backend, { ...PATHS, ...over });
  assert(!result.ok, `expected a refusal for ${JSON.stringify(over)}`);
  return result.why;
}

Deno.test("sandboxPolicy: the environment is exactly a fixed PATH, an empty HOME, a private TMPDIR", () => {
  const policy = policyOf("bwrap");
  assertEquals(policy.env, {
    PATH: "/home/dev/.deno/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: SCRATCH_HOME,
    TMPDIR: SCRATCH_TMP,
  });
});

Deno.test("sandboxPolicy: a container keeps its pinned image's PATH and sees no host toolchain", () => {
  const policy = policyOf("container");
  assertEquals(policy.env, { HOME: SCRATCH_HOME, TMPDIR: SCRATCH_TMP });
  assertEquals(policy.reads, [PATHS.tree]);
  assertEquals(policy.system, []);
});

Deno.test("sandboxPolicy: reads are system and toolchain folders and the tree; writes are scratch", () => {
  const policy = policyOf("seatbelt");
  assertEquals(policy.reads, ["/home/dev/.deno/bin", PATHS.tree]);
  assertEquals(policy.writes, [SCRATCH_HOME, SCRATCH_TMP]);
  assertEquals(policy.workdir, PATHS.tree);
  assert(policy.system.includes("/usr") && policy.system.includes("/System"));
  assert(policyOf("bwrap").system.includes("/usr"));
});

Deno.test("sandboxPolicy: no read or write ever reaches the real home or the checkout", () => {
  for (const backend of ["container", "bwrap", "seatbelt"] as const) {
    const policy = policyOf(backend);
    for (const p of [...policy.system, ...policy.reads, ...policy.writes]) {
      assert(!PATHS.home.startsWith(p), `${backend} reads ${p}, which holds the home`);
      assert(!p.startsWith(PATHS.checkout) && !PATHS.checkout.startsWith(p), `${backend}: ${p}`);
    }
  }
});

Deno.test("sandboxPolicy: a folder that is or holds the home is refused", () => {
  assert(refusal({ toolchain: ["/home/dev"] }).includes("home"));
  assert(refusal({ toolchain: ["/home"] }).includes("home"));
  assert(refusal({ scratch: "/home" }).includes("home"));
  assert(refusal({ home: "/usr/local/dev" }).includes("home"));
});

Deno.test("sandboxPolicy: a folder inside, or holding, the checkout is refused", () => {
  assert(refusal({ tree: "/home/dev/src/my-app/.specnaut/sandbox/abc" }).includes("checkout"));
  assert(refusal({ toolchain: ["/home/dev/src"] }).includes("checkout"));
  assert(refusal({ scratch: "/home/dev/src/my-app/tmp" }).includes("checkout"));
  assert(refusal({ checkout: "/usr/src/my-app" }, "seatbelt").includes("checkout"));
});

Deno.test("sandboxPolicy: scratch may not overlap a folder that is only read", () => {
  assert(refusal({ scratch: `${PATHS.tree}/scratch` }).includes("scratch"));
  assert(refusal({ scratch: "/home/dev/.cache/specnaut/sandbox/abc" }).includes("scratch"));
  assert(refusal({ scratch: "/home/dev/.deno/bin/s" }).includes("scratch"));
  assert(refusal({ scratch: "/usr/tmp/s" }).includes("scratch"));
});

Deno.test("sandboxPolicy: a PATH entry outside every read folder is refused", () => {
  assert(refusal({ path: ["/opt/tools/bin"] }).includes("PATH"));
  assertEquals(sandboxPolicy("bwrap", { ...PATHS, path: ["/usr/lib/node/bin"] }).ok, true);
});

Deno.test("sandboxPolicy: a path the backends cannot quote or that is not plain is refused", () => {
  for (
    const tree of [
      "relative/tree",
      "/",
      "/a/../home/dev",
      "/a//b",
      "/a/b/",
      '/a/"b',
      "/a/b\\c",
      "/a/b,c",
      "/a/b:c",
      "/a/b\nc",
      "/a/\u0000",
    ]
  ) {
    assertEquals(sandboxPolicy("seatbelt", { ...PATHS, tree }).ok, false, JSON.stringify(tree));
  }
});

Deno.test("sandboxPolicy: no network, loopback included, on every backend", () => {
  const image = `ghcr.io/acme/dev@sha256:${"c".repeat(64)}`;
  const ctr = containerArgs(policyOf("container"), { image, name: "gate" }, ["true"]);
  assertEquals(ctr.flatMap((a, i) => (a === "--network" ? [ctr[i + 1]] : [])), ["none"]);
  const bwrap = bwrapArgs(policyOf("bwrap"), ["true"]);
  assert(bwrap.includes("--unshare-all"));
  assertEquals(bwrap.filter((a) => a.startsWith("--share")), []);
  const rules = seatbeltProfile(policyOf("seatbelt")).split("\n");
  const lastAllow = rules.findLastIndex((l) => l.startsWith("(allow"));
  assert(rules.indexOf("(deny network*)") > lastAllow);
});

Deno.test("sandboxPolicy: processes, memory, CPU, wall-clock and scratch are capped", () => {
  const { limits } = policyOf("container");
  assertEquals(limits, LIMITS);
  for (const cap of Object.values(limits)) assert(Number.isFinite(cap) && cap > 0);
});

Deno.test("sandboxPolicy: the allowed macOS services exclude every forbidden one", () => {
  const forbidden = new Set<string>(Object.values(FORBIDDEN_SERVICES).flat());
  for (const service of ALLOWED_SERVICES) assert(!forbidden.has(service), service);
  assertEquals(policyOf("seatbelt").services, ALLOWED_SERVICES);
  assertEquals(policyOf("bwrap").services, []);
  assertEquals(Object.keys(FORBIDDEN_SERVICES).sort(), [
    "appleEvents",
    "keychain",
    "launchServices",
    "pasteboard",
  ]);
});

Deno.test("sandboxPolicy: on macOS only the folders above a visible one may be looked up", () => {
  const policy = policyOf("seatbelt");
  const visible = [...policy.system, ...policy.reads, ...policy.writes];
  for (const lookup of policy.lookups) {
    assert(visible.some((v) => v.startsWith(lookup === "/" ? "/" : `${lookup}/`)), lookup);
  }
  for (const above of ["/", "/home", PATHS.home, "/home/dev/.cache", "/private/var"]) {
    assert(policy.lookups.includes(above), above);
  }
  assert(!policy.lookups.includes(`${PATHS.home}/.ssh`));
  assertEquals(policy.listings, ["/"]);
  assertEquals([policyOf("bwrap").lookups, policyOf("container").listings], [[], []]);
});

Deno.test("sandboxPolicy: kernel values are named on macOS only", () => {
  assertEquals(policyOf("seatbelt").sysctls, SEATBELT_SYSCTLS);
  assertEquals(policyOf("bwrap").sysctls, { names: [], prefixes: [] });
});
