import { assertEquals } from "@std/assert";
import { planConstitutionMove, sameDocument } from "../../src/domain/constitution_move.ts";
import type { DiskEntry } from "../../src/domain/context_link.ts";
import {
  CONSTITUTION_PATH,
  LEGACY_CONSTITUTION_PATH,
} from "../../src/domain/constitution_paths.ts";

/** Every verdict of the legacy constitution move (spec 038, FR-006). */

const file = (content: string, lossy = false): DiskEntry =>
  lossy ? { kind: "file", content, lossy: true } : { kind: "file", content };
const link: DiskEntry = { kind: "symlink", target: "../x.md", resolved: "x.md" };

Deno.test("nothing at the old address: bootstrap only where the new one is empty", () => {
  assertEquals(planConstitutionMove(null, null), { kind: "none", bootstrap: true });
  assertEquals(planConstitutionMove(null, file("ours")), { kind: "none", bootstrap: false });
  assertEquals(planConstitutionMove(null, link), { kind: "none", bootstrap: false });
});

Deno.test("an old file and an empty new address: move, byte for byte", () => {
  assertEquals(planConstitutionMove(file("a\r\nb"), null), {
    kind: "move",
    bootstrap: false,
    content: "a\r\nb",
  });
});

Deno.test("both hold the same text, up to CRLF or a trailing newline: dedupe", () => {
  for (const [old, cur] of [["a\nb\n", "a\nb\n"], ["a\r\nb\r\n", "a\nb"], ["a\nb", "a\nb\n\n"]]) {
    assertEquals(planConstitutionMove(file(old), file(cur)).kind, "dedupe", `${old} / ${cur}`);
  }
});

Deno.test("both hold different text, or the new address is a link or lossy: refuse-conflict", () => {
  for (const cur of [file("a\nc\n"), file(" a\nb"), link, file("a\nb", true)]) {
    assertEquals(planConstitutionMove(file("a\nb"), cur), {
      kind: "refuse-conflict",
      bootstrap: false,
    });
  }
});

Deno.test("an old link or lossy file is refused whatever sits at the new address", () => {
  for (const cur of [null, file("x")]) {
    assertEquals(planConstitutionMove(link, cur), { kind: "refuse-link", bootstrap: false });
    assertEquals(planConstitutionMove(file("x", true), cur), {
      kind: "refuse-lossy",
      bootstrap: false,
    });
  }
});

Deno.test("sameDocument ignores line endings and trailing newlines only", () => {
  assertEquals(sameDocument("a\r\n\r\nb\r\n", "a\n\nb"), true);
  assertEquals(sameDocument("a\n\nb", "a\nb"), false);
  assertEquals(sameDocument("a b", "a  b"), false);
});

Deno.test("an address that cannot be read is refused, never read as absent", () => {
  const denied = { kind: "unreadable", reason: "Permission denied" } as const;
  assertEquals(planConstitutionMove(denied, null), {
    kind: "refuse-unreadable",
    bootstrap: false,
    path: LEGACY_CONSTITUTION_PATH,
    reason: "Permission denied",
  });
  assertEquals(planConstitutionMove(file("ours"), denied), {
    kind: "refuse-unreadable",
    bootstrap: false,
    path: CONSTITUTION_PATH,
    reason: "Permission denied",
  });
  // Nothing to move: the default is held back, an unreadable file is still a file.
  assertEquals(planConstitutionMove(null, denied), { kind: "none", bootstrap: false });
});
