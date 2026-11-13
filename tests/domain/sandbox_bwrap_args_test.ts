import { assert, assertEquals } from "@std/assert";
import { bwrapArgs, scopeArgs, userBus } from "../../src/domain/sandbox_bwrap_args.ts";
import { LIMITS } from "../../src/domain/sandbox_limits.ts";
import { DENIED_SYSCALLS, SECCOMP_FD } from "../../src/domain/sandbox_seccomp.ts";
import { after, PATHS, policyOf, SCRATCH_HOME, SCRATCH_TMP } from "./sandbox_fixture.ts";

/** Bubblewrap's arguments carry the policy and nothing else, every isolation flag present. */

const COMMAND = ["deno", "task", "test"];
const bwrap = () => bwrapArgs(policyOf("bwrap"), COMMAND);

/** The pairs `[a, b]` that follow `flag`, for flags taking two values. */
function pairsAfter(args: readonly string[], flag: string): string[][] {
  return args.flatMap((a, i) => (a === flag ? [[args[i + 1], args[i + 2]]] : []));
}

Deno.test("bwrapArgs: every namespace unshared, tied to its parent, new session, bare environment", () => {
  const args = bwrap();
  assertEquals(args.slice(0, 10), [
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--cap-drop",
    "ALL",
    "--seccomp",
    String(SECCOMP_FD),
  ]);
  assertEquals(args.filter((a) => a.startsWith("--share") || a === "--cap-add"), []);
});

Deno.test("bwrapArgs: no nested user namespace, since the syscall filter lets clone through", () => {
  const args = bwrap();
  const denied: readonly string[] = DENIED_SYSCALLS;
  assertEquals(["clone", "clone3"].filter((c) => denied.includes(c)), [], "the filter's docstring");
  assertEquals(args.filter((a) => a === "--disable-userns"), ["--disable-userns"]);
  assert(args.indexOf("--unshare-user") < args.indexOf("--disable-userns"));
  assertEquals(after(args, "--cap-drop"), ["ALL"]);
});

Deno.test("bwrapArgs: system folders, the toolchain and the tree are bound read-only", () => {
  const policy = policyOf("bwrap");
  const args = bwrap();
  assertEquals(pairsAfter(args, "--ro-bind-try"), policy.system.map((p) => [p, p]));
  assertEquals(pairsAfter(args, "--ro-bind"), [
    ["/home/dev/.deno/bin", "/home/dev/.deno/bin"],
    [PATHS.tree, PATHS.tree],
  ]);
  assertEquals(args.filter((a) => a === "--bind" || a === "--bind-try" || a === "--dev-bind"), []);
});

Deno.test("bwrapArgs: writes go only to size-capped tmpfs: shared memory and scratch", () => {
  const args = bwrap();
  assertEquals(after(args, "--tmpfs"), ["/dev/shm", SCRATCH_HOME, SCRATCH_TMP]);
  args.forEach((a, i) => {
    if (a === "--tmpfs") {
      assertEquals(args.slice(i - 2, i), ["--size", String(LIMITS.scratchBytes)]);
    }
  });
  assert(args.indexOf("--tmpfs") > args.indexOf("--dev"), "the shm tmpfs replaces --dev's own");
});

Deno.test("bwrapArgs: the sandbox's root is remounted read-only as the last option", () => {
  const args = bwrap();
  const end = args.indexOf("--");
  assertEquals(args.slice(end - 2, end), ["--remount-ro", "/"]);
  assertEquals(after(args, "--remount-ro"), ["/"]);
});

Deno.test("bwrapArgs: the environment is exactly the policy's, and the command follows `--`", () => {
  const policy = policyOf("bwrap");
  const args = bwrap();
  assertEquals(pairsAfter(args, "--setenv"), Object.entries(policy.env));
  assertEquals(after(args, "--chdir"), [PATHS.tree]);
  assertEquals(args.slice(-1 - COMMAND.length), ["--", ...COMMAND]);
  assertEquals(args.filter((a) => a === "--"), ["--"]);
});

Deno.test("scopeArgs: a systemd user scope carrying the policy's memory, process and CPU caps", () => {
  assertEquals(scopeArgs(policyOf("bwrap")), [
    "systemd-run",
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    "-p",
    `MemoryMax=${LIMITS.memoryBytes}`,
    "-p",
    "MemorySwapMax=0",
    "-p",
    `TasksMax=${LIMITS.processes}`,
    "-p",
    `CPUQuota=${LIMITS.cpus * 100}%`,
    "-p",
    "OOMPolicy=continue",
  ]);
});

Deno.test("userBus: the two variables systemd-run needs to reach the user manager, and no other", () => {
  const host: Record<string, string> = {
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    HOME: "/home/dev",
    GH_TOKEN: "t0k3n",
  };
  assertEquals(userBus((name) => host[name]), {
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  });
  assertEquals(userBus(() => undefined), {});
});
