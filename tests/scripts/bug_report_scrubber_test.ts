import { assertEquals, assertStringIncludes } from "@std/assert";

// Canonical scrubbing patterns, mirrored from the
// `## Bug report protocol` section of
// `templates/core/agents/specnaut-expert.md`. Keeping this list and
// the agent prompt in lockstep is critical — the LLM uses the prompt
// as its rule set, and this test exercises the same rules to catch
// regressions in the canonical list.
const HARD_PATTERNS: ReadonlyArray<RegExp> = [
  /ghp_[A-Za-z0-9_]{36,}/g,
  /gho_[A-Za-z0-9_]{36,}/g,
  /ghu_[A-Za-z0-9_]{36,}/g,
  /ghs_[A-Za-z0-9_]{36,}/g,
  /ghr_[A-Za-z0-9_]{36,}/g,
  /github_pat_[A-Za-z0-9_]{82,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /sk-ant-api\d{2}-[A-Za-z0-9_-]{93,}/g,
  /sk-[A-Za-z0-9]{48,}/g,
  /AKIA[0-9A-Z]{16}/g,
];

// Soft-redaction: paths under sensitive directories. Replaced by
// `[REDACTED: <type>]` where <type> is the directory name. The agent
// has the latitude to keep the directory hint visible since the
// content (key files) is what's sensitive, not the path's existence.
const SOFT_PATH_PATTERNS: ReadonlyArray<{ re: RegExp; type: string }> = [
  { re: /~\/\.ssh\/[A-Za-z0-9_.-]+/g, type: "ssh" },
  { re: /~\/\.aws\/[A-Za-z0-9_.-]+/g, type: "aws" },
  { re: /~\/\.config\/gh\/[A-Za-z0-9_.-]+/g, type: "gh-config" },
];

function scrub(input: string): string {
  let out = input;
  for (const re of HARD_PATTERNS) out = out.replace(re, "[REDACTED]");
  for (const { re, type } of SOFT_PATH_PATTERNS) {
    out = out.replace(re, `[REDACTED: ${type}]`);
  }
  return out;
}

Deno.test("scrub redacts a classic GitHub PAT", () => {
  const corpus = "Authorization: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const out = scrub(corpus);
  assertEquals(out.includes("ghp_"), false);
  assertStringIncludes(out, "[REDACTED]");
});

Deno.test("scrub redacts a fine-grained GitHub PAT", () => {
  const tail = "x".repeat(82);
  const out = scrub(`token: github_pat_${tail}`);
  assertEquals(out.includes("github_pat_"), false);
});

Deno.test("scrub redacts an Anthropic key", () => {
  const tail = "x".repeat(93);
  const out = scrub(`ANTHROPIC_API_KEY=sk-ant-api03-${tail}`);
  assertEquals(out.includes("sk-ant-api03-"), false);
});

Deno.test("scrub redacts an OpenAI-shaped key (>=48 chars)", () => {
  const tail = "x".repeat(48);
  const out = scrub(`OPENAI_API_KEY=sk-${tail}`);
  assertStringIncludes(out, "[REDACTED]");
});

Deno.test("scrub redacts an AWS access key id", () => {
  const out = scrub("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
  assertEquals(out.includes("AKIA"), false);
});

Deno.test("scrub redacts a GitLab PAT", () => {
  const out = scrub("token: glpat-aaaaaaaaaaaaaaaaaaaa");
  assertEquals(out.includes("glpat-"), false);
});

Deno.test("scrub soft-redacts paths under ~/.ssh/", () => {
  const out = scrub("Cannot read /Users/me/.ssh/id_rsa.pub");
  // Only the path tail under ~/.ssh/ matches; the absolute prefix is
  // independent. Test the agent-format (~) path explicitly.
  const out2 = scrub("Cannot read ~/.ssh/id_rsa.pub");
  assertStringIncludes(out2, "[REDACTED: ssh]");
  // Sanity: absolute path is left alone — the pattern targets the
  // tilde form the user is likely to paste from a shell error.
  assertEquals(out.includes("/Users/me/.ssh/id_rsa.pub"), true);
});

Deno.test("scrub does NOT redact a SHA-256 hex string", () => {
  // 64-char hex SHA256 — must NOT match any hard pattern (would have
  // false-positived under a naive AWS-secret-key rule that we
  // deliberately omitted from V1).
  const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const out = scrub(`hash: ${sha}`);
  assertStringIncludes(out, sha, "SHA-256 hex must survive scrubbing");
});

Deno.test("scrub does NOT redact a plain email address (V1 contract)", () => {
  // V1 deliberately leaves emails alone — the agent surfaces a
  // human-review reminder instead. Locks the contract via a test so
  // a future change has to flip this assertion explicitly.
  const out = scrub("Author: kevin@example.com");
  assertStringIncludes(out, "kevin@example.com");
});

Deno.test("scrub handles multiple tokens in one corpus", () => {
  const corpus = [
    "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "AKIAIOSFODNN7EXAMPLE",
    `sk-ant-api03-${"y".repeat(93)}`,
  ].join("\n");
  const out = scrub(corpus);
  assertEquals(out.includes("ghp_"), false);
  assertEquals(out.includes("AKIA"), false);
  assertEquals(out.includes("sk-ant-"), false);
  // Three matches → three [REDACTED] markers.
  const matches = out.match(/\[REDACTED\]/g) ?? [];
  assertEquals(matches.length, 3);
});
