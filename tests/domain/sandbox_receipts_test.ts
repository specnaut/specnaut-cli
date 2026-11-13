import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { sandboxPolicy } from "../../src/domain/sandbox.ts";
import { containerArgs } from "../../src/domain/sandbox_args.ts";
import { bwrapArgs } from "../../src/domain/sandbox_bwrap_args.ts";
import { HOME_RECEIPTS } from "../../src/domain/sandbox_paths.ts";
import { seatbeltProfile } from "../../src/domain/sandbox_seatbelt.ts";
import { PATHS, policyOf } from "./sandbox_fixture.ts";

/**
 * The receipts a pipx or uv venv keeps, which can name an index or git URL carrying a login:
 * never read, on any backend, though the venv's folder is.
 */

const VENVS = `${PATHS.home}/.local/share/pipx/venvs`;
const TOOLS = `${PATHS.home}/.local/share/uv/tools`;
const PIPX = `${VENVS}/ruff/pipx_metadata.json`;
const UV = `${TOOLS}/black/uv-receipt.toml`;

/** The layout with the venv roots read and the host's receipts found. */
const withVenvs = (receipts: string[], toolchain = [VENVS, TOOLS]) => ({
  ...PATHS,
  toolchain,
  path: [],
  receipts,
});

Deno.test("HOME_RECEIPTS: the receipts a venv keeps are the ones stated", () => {
  assertEquals([...HOME_RECEIPTS], [
    ".local/share/pipx/venvs/*/pipx_metadata.json",
    ".local/share/uv/tools/*/uv-receipt.toml",
  ]);
});

Deno.test("sandboxPolicy: a receipt in a folder the sandbox reads is a hidden file", () => {
  for (const backend of ["bwrap", "seatbelt"] as const) {
    assertEquals(policyOf(backend, withVenvs([PIPX, UV])).hiddenFiles, [PIPX, UV], backend);
  }
});

Deno.test("sandboxPolicy: a receipt in no folder the sandbox reads is not named", () => {
  const policy = policyOf("bwrap", withVenvs([PIPX, UV], [`${VENVS}/ruff/bin`, TOOLS]));
  assertEquals(policy.hiddenFiles, [UV]);
  // A container reads its image's tools, never the host's: there is nothing to hide.
  assertEquals(policyOf("container", withVenvs([PIPX, UV])).hiddenFiles, []);
});

Deno.test("seatbeltProfile: each hidden file is denied to every read, after the allows", () => {
  const profile = seatbeltProfile(policyOf("seatbelt", withVenvs([PIPX, UV])));
  const deny = `(deny file-read* (literal "${PIPX}") (literal "${UV}"))`;
  assertStringIncludes(profile, deny);
  assert(profile.indexOf(deny) > profile.indexOf("(allow file-read* (subpath"), profile);
});

Deno.test("bwrapArgs: each hidden file is covered by an empty file, after its folder is bound", () => {
  const args = bwrapArgs(policyOf("bwrap", withVenvs([PIPX])), ["true"]);
  const cover = args.findIndex((a, i) => a === "--ro-bind" && args[i + 1] === "/dev/null");
  assertEquals(args.slice(cover, cover + 3), ["--ro-bind", "/dev/null", PIPX]);
  assert(cover > args.indexOf(VENVS), "the cover is bound before the folder it lies in");
});

Deno.test("containerArgs: no host receipt is mounted, as no host tool folder is", () => {
  const policy = policyOf("container", withVenvs([PIPX]));
  const image = `localhost/gates@sha256:${"a".repeat(64)}`;
  const run = {
    image,
    name: "specnaut-gate-1",
    engine: "podman",
    dropped: [],
    cpus: null,
  } as const;
  const args = containerArgs(policy, run, ["true"]);
  assert(!args.some((a) => a.includes(".local/share")), args.join(" "));
});

Deno.test("sandboxPolicy: a receipt a backend cannot quote refuses the layout", () => {
  const odd = `${VENVS}/a,b/pipx_metadata.json`;
  const result = sandboxPolicy("bwrap", withVenvs([odd]));
  assertEquals(result.ok, false);
  assertStringIncludes(result.ok ? "" : result.why, "cannot quote");
});
