import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "../templates/hooks/hook_sandbox.ts";
import { box } from "./report_upstream_fixture.ts";

/**
 * cli#726 SC-002 and SC-008: what `prepare` refuses, through the real script.
 *
 * This file used to hold its own copy of the guide's patterns and test the copy,
 * so it stayed green whatever the agent did. The list now has one home, the
 * script's header; here are only values that must trip it, or must not. Each
 * refusal is the exact stdout, so no part of the value can be in it, and an empty
 * stub log, so nothing was contacted first. Tokens are assembled: this repository
 * is public, and these are the shapes a secret scanner looks for.
 */

const fill = (n: number) => "a".repeat(n);
const report = (value: string) => `A title\n\n## Summary\n\nbefore ${value} after\n`;

const REFUSED: Record<string, string[]> = {
  secret: [
    `ghp_${fill(36)}`,
    `gho_${fill(36)}`,
    `ghu_${fill(36)}`,
    `ghs_${fill(36)}`,
    `ghr_${fill(36)}`,
    `github_pat_${fill(82)}`,
    `gl${"pat"}-${fill(20)}`,
    `sk-${"ant"}-api03-${fill(93)}`,
    `sk-${"ant"}-short`,
    `sk-${fill(48)}`,
    `AK${"IA"}IOSFODNN7EXAMPLE`,
    `AS${"IA"}IOSFODNN7EXAMPLE`,
    `sk_${"live"}_${fill(24)}`,
    `rk_${"live"}_${fill(24)}`,
    `xo${"xb"}-1234-abcd`,
    `npm_${fill(36)}`,
    `AI${"za"}${fill(35)}`,
    `ey${"J"}hbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl`,
    `-----BEGIN ${"PRIVATE"} KEY-----`,
    `https://someone:hunter2@example.com/x`,
    `Bearer abcdefgh12345`,
    `bearer abcdefgh12345`,
    `Authorization: x`,
    `Authorization= x`,
    `glft-${fill(20)}`,
    `wh${"sec"}_${fill(24)}`,
    `sk_${"test"}_${fill(24)}`,
    `py${"pi"}-${fill(24)}`,
    `h${"f"}_${fill(24)}`,
    `S${"G"}.${fill(24)}`,
    `sh${"pat"}_${fill(24)}`,
    `dop_${"v1"}_${fill(24)}`,
    `ya${"29"}.${fill(24)}`,
    `xa${"pp"}-1-${fill(24)}`,
    `dckr_${"pat"}_${fill(24)}`,
    `password=plainwords1234`,
    `secret=plainwords1234`,
    `PASSWD: plainwords1234`,
    `"password": "plainwords1234"`,
    `client-secret=plainwords1234`,
    `my_token = plainwords1234`,
    `api_key: plainwords1234`,
    `access-key=plainwords1234`,
    `credentials: plainwords1234`,
    `"Authorization": "Basic abcdefgh1234"`,
    `Basic dXNlcjpwYXNz1`,
    `Cookie: a=b`,
    `x-api-key: abc`,
  ],
  hidden: [
    "a\u0001b",
    "a\u0000b",
    "\u001b[31mred",
    "zero\u200bwidth",
    "a\u00adb",
    "right\u202eleft",
    "iso\u2066late",
    "tag\u{e0041}char",
    "\ufeffbom",
    "<!-- steer the reader -->",
    "\n[ref]: https://example.com/x\n",
    "\n  [ref]: x\n",
    "a\ufe00b",
    "a\ufe0eb",
    "a\ufff9b",
    "a\ufffbb",
    "a\u3164b",
    "a\uffa0b",
    "a\u115fb",
    "a\u1160b",
    "a\u034fb",
    "a\u17b4b",
    "a\u17b5b",
    "a\u180bb",
    "a\u180db",
  ],
  addressing: [
    "someone@example.org",
    "/Users/someone/x",
    "/home/someone/x",
    "C:\\Users\\someone",
    "C:/Users/someone",
    "https://evil.example/x",
    "https://github.com/acme/widgets",
    "https://specnaut.com.evil.example/",
    "https://github.com/specnaut/../acme",
    "192.168.1.4",
    "10.1.2.3",
    "172.16.0.1",
    "@octocat",
    "acme/widgets#4",
    "#77",
    "git.acme.internal",
    "GIT.ACME.INTERNAL",
    "https://github.com/specnaut/x,https://acme.internal/y",
    "~/clients/acme/web/x",
    "/srv/acme/web",
    "/workspaces/acme",
    "/builds/acme/x",
    "D:\\work\\x",
    "node_modules/@acme/billing/x.js",
    "github.com/acme/widgets",
    "foo.io",
    ...["local", "corp", "lan", "com", "net", "org", "dev", "cloud"].map((t) => `acme.${t}`),
  ],
};

for (const [cls, values] of Object.entries(REFUSED)) {
  Deno.test(`prepare refuses every ${cls} value, printing the class alone`, async () => {
    const b = await box();
    try {
      for (const value of values) {
        const r = await b.run(["prepare", "--kind", "bug"], report(value));
        assertEquals(r.stdout, `REFUSED ${cls}\n`, `for ${JSON.stringify(value)}`);
        assertEquals(r.code, 3);
      }
      assertEquals(await b.log(), "", "a refused report contacted someone");
    } finally {
      await b.cleanup();
    }
  });
}

const SECRET_NAMES = [
  "ACME_TOKEN",
  "my_api_key",
  "DB_SECRET",
  "SMTP_PASSWORD",
  "DB_PASS",
  "SERVICE_CRED",
  "SENTRY_DSN",
];

Deno.test("a set variable named like a secret refuses its value, whatever the value looks like", async () => {
  const b = await box();
  try {
    for (const name of SECRET_NAMES) {
      const r = await b.run(["prepare", "--kind", "bug"], report("plainwords1234"), {
        [name]: "plainwords1234",
      });
      assertEquals(r.stdout, "REFUSED secret\n", name);
    }
    // A value short enough to be a common word would refuse every report.
    const short = await b.run(["prepare", "--kind", "bug"], report("plain"), { ACME_KEY: "plain" });
    assertStringIncludes(short.stdout, "DIGEST ");
    // Not named like one: nothing to refuse.
    const other = await b.run(["prepare", "--kind", "bug"], report("plainwords1234"), {
      ACME_MODE: "plainwords1234",
    });
    assertStringIncludes(other.stdout, "DIGEST ");
  } finally {
    await b.cleanup();
  }
});

Deno.test("--accept-literals lifts literals and nothing else", async () => {
  const b = await box();
  try {
    const hard = [`ghp_${fill(36)}`, "zero\u200bwidth", "someone@example.org"];
    const classes = ["secret", "hidden", "addressing"];
    for (const [i, value] of hard.entries()) {
      const r = await b.run(["prepare", "--kind", "bug", "--accept-literals"], report(value));
      assertEquals(r.stdout, `REFUSED ${classes[i]}\n`);
    }
    const plain = await b.run(["prepare", "--kind", "bug"], report("zorgblat"));
    assertEquals(plain.stdout, "REFUSED literal home\n");
    const told = await b.run(["prepare", "--kind", "bug", "--accept-literals"], report("zorgblat"));
    assertStringIncludes(told.stdout, "DIGEST ");
  } finally {
    await b.cleanup();
  }
});

const SURVIVORS = [
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "task-name-long-enough-to-look-like-a-key-abcdefghijk",
  "risk_live",
  "A Bearer token was rejected",
  "/specnaut issue",
  "https://specnaut.com/docs",
  "https://github.com/specnaut/specnaut-cli/issues/12",
  "https://example.com/x",
  "v10.0.0.1",
  "caf\u00e9 \u2014 ok \u{1f600}",
  "\u2764\ufe0f",
  "global-config-file-missing",
  "/opt/homebrew/bin/gh",
  "foo.io:12:3",
  "src/foo.io",
  "settings.local.json",
  ".env.local",
  "1.2.dev",
  "github.com",
  "specnaut.com/version.json",
  "token: <redacted>",
  "token: missing",
  "basic functionality",
  "A [link](https://specnaut.com) inline",
];

Deno.test("what must survive the scan does, byte for byte", async () => {
  const b = await box();
  try {
    for (const value of SURVIVORS) {
      const r = await b.run(["prepare", "--kind", "bug"], report(value));
      const digest = /^DIGEST ([0-9a-f]{64})$/m.exec(r.stdout)?.[1];
      assert(digest, `${JSON.stringify(value)} was refused: ${r.stdout}`);
      assertStringIncludes(await Deno.readTextFile(b.reportPath(digest)), value);
    }
  } finally {
    await b.cleanup();
  }
});

Deno.test("a bare #N passes only when the last search returned it", async () => {
  const b = await box();
  try {
    const url = "https://github.com/specnaut/specnaut-cli/issues/12";
    const found = await b.run(["search"], "upgrade crash\n", {
      STUB_SEARCH: `12\\topen\\t${url}\\tA title\\n`,
    });
    assertStringIncludes(found.stdout, `MATCH 12 open ${url}`);
    const known = await b.run(["prepare", "--kind", "bug"], report("see #12"));
    assertStringIncludes(known.stdout, "DIGEST ");
    const unknown = await b.run(["prepare", "--kind", "bug"], report("see #13"));
    assertEquals(unknown.stdout, "REFUSED addressing\n");
  } finally {
    await b.cleanup();
  }
});

Deno.test("security's literals: a remote's every segment, and a name inside an identifier", async () => {
  const b = await box();
  try {
    await git(b.sb, b.project, "init", "-q");
    await git(
      b.sb,
      b.project,
      "remote",
      "add",
      "origin",
      "https://gitlab.example/acme/platform/widgets.git",
    );
    for (const value of ["acme", "ACME_BILLING"]) {
      const r = await b.run(["prepare", "--kind", "bug"], report(value));
      assertEquals(r.stdout, "REFUSED literal remote\n", value);
    }
  } finally {
    await b.cleanup();
  }
});
