import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "../templates/hooks/hook_sandbox.ts";
import { box } from "./report_upstream_fixture.ts";
import {
  ENV_VALUE,
  HIDDEN_SAMPLES,
  SECRET_NAMES,
  SECRET_SAMPLES,
  SURVIVORS,
} from "./secret_samples.ts";

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

const report = (value: string) => `A title\n\n## Summary\n\nbefore ${value} after\n`;

const REFUSED: Record<string, readonly string[]> = {
  secret: SECRET_SAMPLES,
  hidden: HIDDEN_SAMPLES,
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

Deno.test("a set variable named like a secret refuses its value, whatever the value looks like", async () => {
  const b = await box();
  try {
    for (const name of SECRET_NAMES) {
      const r = await b.run(["prepare", "--kind", "bug"], report(ENV_VALUE), {
        [name]: ENV_VALUE,
      });
      assertEquals(r.stdout, "REFUSED secret\n", name);
    }
    // A value short enough to be a common word would refuse every report.
    const short = await b.run(["prepare", "--kind", "bug"], report("plain"), { ACME_KEY: "plain" });
    assertStringIncludes(short.stdout, "DIGEST ");
    // Not named like one: nothing to refuse.
    const other = await b.run(["prepare", "--kind", "bug"], report(ENV_VALUE), {
      ACME_MODE: ENV_VALUE,
    });
    assertStringIncludes(other.stdout, "DIGEST ");
  } finally {
    await b.cleanup();
  }
});

Deno.test("--accept-literals lifts literals and nothing else", async () => {
  const b = await box();
  try {
    const hard = [SECRET_SAMPLES[0], "zero\u200bwidth", "someone@example.org"];
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
