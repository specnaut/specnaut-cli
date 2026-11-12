import { assertEquals } from "@std/assert";
import {
  FETCHED_REF,
  isCommitSha,
  parseBranchSource,
  refspecOf,
} from "../../src/domain/branch_source.ts";

const REMOTES = ["origin", "my/fork"];
const parse = (text: string) => parseBranchSource(text, REMOTES);

Deno.test("a PR number names the pull head on origin", () => {
  assertEquals(parse("42"), { kind: "pr", remote: "origin", number: 42 });
  assertEquals(parse("#7"), { kind: "pr", remote: "origin", number: 7 });
  assertEquals(refspecOf({ kind: "pr", remote: "origin", number: 42 }), "refs/pull/42/head");
});

Deno.test("a PR number needs origin to be configured", () => {
  const out = parseBranchSource("42", ["upstream"]);
  assertEquals(out.kind, "refused");
});

Deno.test("a PR number is a positive integer, nothing more", () => {
  for (const text of ["0", "07", "-1", "1e3", "42 ", " 42", "12345678901"]) {
    assertEquals(parse(text).kind, "refused", text);
  }
});

Deno.test("a ref names a branch on a configured remote, the longest remote first", () => {
  assertEquals(parse("origin/feature/x"), { kind: "ref", remote: "origin", branch: "feature/x" });
  assertEquals(parse("my/fork/topic"), { kind: "ref", remote: "my/fork", branch: "topic" });
  assertEquals(refspecOf({ kind: "ref", remote: "origin", branch: "a/b" }), "refs/heads/a/b");
});

Deno.test("a remote that is not configured is refused", () => {
  const out = parse("elsewhere/main");
  assertEquals(out.kind === "refused" && out.why.includes("configured remote"), true);
});

Deno.test("a URL or a path is refused, whatever its form", () => {
  for (
    const text of [
      "https://example.com/acme/my-app.git",
      "file:///tmp/repo",
      "ext::sh -c touch% /tmp/x",
      "git@example.com:acme/my-app.git",
      "/tmp/repo",
      "./repo",
      "../repo",
      "~/repo",
      "C:\\repo",
    ]
  ) {
    const out = parse(text);
    assertEquals(out.kind === "refused" && out.why.includes("URL or a path"), true, text);
  }
});

Deno.test("a branch name git or a shell could read as something else is refused", () => {
  for (
    const branch of [
      "-x",
      "--upload-pack=x",
      "a/../b",
      "a..b",
      ".hidden",
      "a/.b",
      "a.lock",
      "a@{1}",
      "a//b",
      "a/",
      "a b",
      "a\nb",
      "a~1",
      "a^",
      "a:b",
      "a*",
      "",
    ]
  ) {
    assertEquals(parse(`origin/${branch}`).kind, "refused", JSON.stringify(branch));
  }
});

Deno.test("the fetched head lands on one private ref", () => {
  assertEquals(FETCHED_REF, "refs/specnaut/head");
});

Deno.test("a commit id is 40 or 64 lowercase hex digits and nothing else", () => {
  assertEquals(isCommitSha("a".repeat(40)), true);
  assertEquals(isCommitSha("0123456789abcdef".repeat(4)), true);
  for (
    const bad of [
      "a".repeat(39),
      "a".repeat(41),
      "a".repeat(63),
      "A".repeat(40),
      `${"a".repeat(40)}\n`,
      `../${"a".repeat(37)}`,
      "g".repeat(40),
      "",
    ]
  ) {
    assertEquals(isCommitSha(bad), false, JSON.stringify(bad));
  }
});
