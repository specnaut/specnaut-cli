import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import {
  assertGrammar,
  box,
  constant,
  CREATED,
  createLines,
  ISSUE_99,
  REPORT,
} from "./report_upstream_fixture.ts";

/**
 * cli#726: the digest, the pinned coordinates, the separate facts of CREATED and
 * ISSUE, through the real script and a stubbed `gh`. The scan's classes are in
 * `bug_report_scrubber_test.ts`, what comes back from upstream in
 * `report_upstream_search_test.ts`.
 */

Deno.test("FR-004: prepare stores the bytes in a 0700 directory, named by their digest", async () => {
  const b = await box();
  try {
    const r = await b.run(
      ["prepare", "--kind", "proposal"],
      "A title\r\n\r\n## Why\r\n\r\nBecause.",
    );
    assertEquals(r.code, 0);
    assertGrammar(r.stdout);
    const digest = /^DIGEST ([0-9a-f]{64})$/m.exec(r.stdout)![1];
    assertStringIncludes(r.stdout, "POSTING_AS octo\n");
    assert(/^FILE .*\.specnaut\/reports\/[0-9a-f]{64}\.md$/m.test(r.stdout), r.stdout);
    const bytes = await Deno.readFile(b.reportPath(digest));
    assertEquals(
      new TextDecoder().decode(bytes),
      "kind: proposal\ntitle: A title\n\n## Why\n\nBecause.\n",
    );
    assertEquals(encodeHex(await crypto.subtle.digest("SHA-256", bytes)), digest);
    if (Deno.build.os !== "windows") {
      const stat = await Deno.stat(join(b.sb.home, ".specnaut", "reports"));
      assertEquals(stat.mode! & 0o777, 0o700);
    }
  } finally {
    await b.cleanup();
  }
});

Deno.test("the approved bytes are the bytes sent: body on stdin, title as written, no path", async () => {
  const b = await box();
  try {
    const digest = await b.prepared("/task plan breaks\n\n## Summary\n\ncafé\n\n\n");
    const r = await b.run(["create", digest], "", CREATED);
    assertEquals(r.code, 0);
    assertStringIncludes(r.stdout, `CREATED ${ISSUE_99}\nISSUE ok\n`);
    assertEquals(await b.sent("sent-body"), "## Summary\n\ncafé\n\n\n");
    const argv = (await b.sent("sent-argv")).split("\n");
    assertEquals(argv[argv.indexOf("--title") + 1], "/task plan breaks");
    assertEquals(argv[argv.indexOf("--body-file") + 1], "-");
    assertEquals(argv[argv.indexOf("--repo") + 1], constant("REPO"));
  } finally {
    await b.cleanup();
  }
});

Deno.test("SC-001: another digest, an edit and a symlink each refuse, and nothing is created", async () => {
  const b = await box();
  try {
    const digest = await b.prepared();
    const path = b.reportPath(digest);
    const original = await Deno.readTextFile(path);

    for (const bad of ["0".repeat(64), "nope", "../../etc/passwd", ""]) {
      assertEquals((await b.run(["create", bad], "", CREATED)).stdout, "REFUSED digest\n", bad);
    }

    await Deno.writeTextFile(path, original + "one more line\n");
    assertEquals((await b.run(["create", digest], "", CREATED)).stdout, "REFUSED digest\n");
    assertEquals((await b.run(["link", digest])).stdout, "REFUSED digest\n");

    if (Deno.build.os !== "windows") {
      const elsewhere = join(b.sb.dir, "same-bytes.md");
      await Deno.writeTextFile(elsewhere, original);
      await Deno.remove(path);
      await Deno.symlink(elsewhere, path);
      assertEquals((await b.run(["create", digest], "", CREATED)).stdout, "REFUSED digest\n");
    }
    assertEquals(createLines(await b.log()), [], "a refused digest still created");
  } finally {
    await b.cleanup();
  }
});

Deno.test("create rescans what it was handed: a file with its own right name is not a pass", async () => {
  const b = await box();
  try {
    const text = `kind: bug\ntitle: t\n\nghp_${"a".repeat(36)}\n`;
    const bytes = new TextEncoder().encode(text);
    const digest = encodeHex(await crypto.subtle.digest("SHA-256", bytes));
    await Deno.mkdir(join(b.sb.home, ".specnaut", "reports"), { recursive: true });
    await Deno.writeFile(b.reportPath(digest), bytes);
    assertEquals((await b.run(["create", digest], "", CREATED)).stdout, "REFUSED secret\n");
    assertEquals(createLines(await b.log()), []);
  } finally {
    await b.cleanup();
  }
});

Deno.test("SC-004: a URL on another host is unverified, with its own exit", async () => {
  const b = await box();
  try {
    const digest = await b.prepared();
    const r = await b.run(["create", digest], "", {
      STUB_CREATE_OUT: "https://evil.example/specnaut/specnaut-cli/issues/9",
    });
    assertEquals(r.stdout, "CREATED unverified\n");
    assertEquals(r.code, 5);
    assertEquals((await b.log()).includes("issue view"), false, "read back an unverified URL");
  } finally {
    await b.cleanup();
  }
});

Deno.test("SC-004: a failure after create says so, and a retry never creates again", async () => {
  const b = await box();
  try {
    const digest = await b.prepared();
    const env = { STUB_CREATE_OUT: ISSUE_99, STUB_VIEW_RC: "1", STUB_PERMS: "true true" };
    const first = await b.run(["create", digest], "", env);
    assertEquals(first.code, 6);
    assertEquals(
      first.stdout,
      `CREATED ${ISSUE_99}\nISSUE unreadable\n`,
    );
    const second = await b.run(["create", digest], "", CREATED);
    assertEquals(second.code, 0);
    assertStringIncludes(second.stdout, `CREATED ${ISSUE_99}\nISSUE ok\n`);
    assertEquals(createLines(await b.log()).length, 1);
  } finally {
    await b.cleanup();
  }
});

Deno.test("a create whose outcome is unknown stays stopped until a new prepare, a new ask", async () => {
  const b = await box();
  try {
    const digest = await b.prepared();
    const failed = await b.run(["create", digest], "", { STUB_CREATE_RC: "1" });
    assertEquals(failed.stdout, "CREATED unverified\n");
    assertEquals(failed.code, 5);
    assertEquals((await b.run(["create", digest], "", CREATED)).stdout, "CREATED unverified\n");
    assertEquals(createLines(await b.log()).length, 1);

    assertEquals(await b.prepared(), digest);
    const retried = await b.run(["create", digest], "", CREATED);
    assertStringIncludes(retried.stdout, `CREATED ${ISSUE_99}\n`);
    assertEquals(createLines(await b.log()).length, 2);
  } finally {
    await b.cleanup();
  }
});

Deno.test("SC-005: the host and repository are pinned, and a mismatched id refuses", async () => {
  const b = await box();
  try {
    const steer = { GH_HOST: "git.evil.example", GH_REPO: "acme/widgets", GH_DEBUG: "api" };
    const digest = await b.prepared();
    await b.run(["search"], "upgrade\n", steer);
    await b.run(["create", digest], "", { ...steer, ...CREATED });
    const log = (await b.log()).trimEnd().split("\n");
    assert(log.length >= 4, log.join("\n"));
    for (const line of log) assert(line.startsWith("host=github.com repo=unset "), line);
    assertStringIncludes(log.join("\n"), `argv=api repos/${constant("REPO")} `);

    const other = await b.prepared("Other\n\nOther body.\n");
    const r = await b.run(["create", other], "", { ...CREATED, STUB_ID: "1" });
    assertEquals(r.stdout, "REFUSED repository\n");
    assertEquals(r.code, 3);
    assertEquals(createLines(await b.log()).length, 1, "a mismatched id still created");
  } finally {
    await b.cleanup();
  }
});

Deno.test("SC-007: labels only with push or triage, and only what the read-back shows is set", async () => {
  const cases = [
    { perms: "false false", asked: false },
    { perms: "null null", asked: false },
    { perms: "true false", asked: true },
    { perms: "false true", asked: true },
  ];
  for (const { perms, asked } of cases) {
    const b = await box();
    try {
      const digest = await b.prepared();
      const r = await b.run(["create", digest], "", {
        STUB_PERMS: perms,
        STUB_CREATE_OUT: ISSUE_99,
        STUB_VIEW_OUT: asked ? "99\\tbug\\tfrom:specnaut-guide\\n" : "99\\n",
      });
      assertEquals(createLines(await b.log())[0].includes("--label"), asked, perms);
      const word = asked ? "set" : "skipped";
      assertStringIncludes(r.stdout, `LABEL bug ${word}\nLABEL from:specnaut-guide ${word}\n`);
    } finally {
      await b.cleanup();
    }
  }
});

Deno.test("a proposal asks for the proposal label, and a label asked for but not shown is skipped", async () => {
  const b = await box();
  try {
    const r = await b.run(["prepare", "--kind", "proposal"], REPORT);
    const digest = /^DIGEST (\S+)$/m.exec(r.stdout)![1];
    const c = await b.run(["create", digest], "", {
      STUB_PERMS: "true true",
      STUB_CREATE_OUT: ISSUE_99,
      STUB_VIEW_OUT: "99\\tenhancement\\n",
    });
    assertStringIncludes(
      createLines(await b.log())[0],
      "--label enhancement --label from:specnaut-guide",
    );
    assertStringIncludes(c.stdout, "LABEL enhancement set\nLABEL from:specnaut-guide skipped\n");
  } finally {
    await b.cleanup();
  }
});

Deno.test("FR-016: the link decodes to the scanned bytes, and a long one says too-long", async () => {
  const b = await box();
  try {
    const title = "A title & more #1?";
    const body = "## Summary\n\nsp ace + café\n";
    const r = await b.run(["search"], "x\n", {
      STUB_SEARCH: `1\\topen\\thttps://github.com/${constant("REPO")}/issues/1\\tA\\n`,
    });
    assertEquals(r.code, 0);
    const digest = await b.prepared(`${title}\n\n${body}`);
    const link = await b.run(["link", digest]);
    const line = /^LINK (\S+)$/.exec(link.stdout.trimEnd())![1];
    const url = new URL(line);
    assertEquals(url.origin + url.pathname, `https://github.com/${constant("REPO")}/issues/new`);
    assertEquals(url.searchParams.get("title"), title);
    assertEquals(url.searchParams.get("body"), body);
    assertEquals(url.searchParams.get("labels"), null, "the link asks for a label");
    assertEquals(createLines(await b.log()), [], "a link created an issue");

    const long = await b.prepared(`A title\n\n${"word ".repeat(700)}\n`);
    assertEquals((await b.run(["link", long])).stdout, "LINK too-long\n");
  } finally {
    await b.cleanup();
  }
});

Deno.test("empty and oversized reports, and bad usage, are stated", async () => {
  const b = await box();
  try {
    assertEquals(
      (await b.run(["prepare", "--kind", "bug"], "Title only\n")).stdout,
      "REFUSED empty\n",
    );
    assertEquals(
      (await b.run(["prepare", "--kind", "bug"], "\n\nBody\n")).stdout,
      "REFUSED empty\n",
    );
    const long = `${"t".repeat(257)}\n\nA body.\n`;
    assertEquals((await b.run(["prepare", "--kind", "bug"], long)).stdout, "REFUSED size\n");
    const big = `A title\n\n${"x".repeat(60001)}\n`;
    assertEquals((await b.run(["prepare", "--kind", "bug"], big)).stdout, "REFUSED size\n");
    assertEquals((await b.run(["prepare", "--kind", "epic"], REPORT)).code, 2);
    const nope = await b.run(["nope"]);
    assertEquals(nope.code, 2);
    assertEquals(nope.stdout, "");
    assertEquals(await b.log(), "");
  } finally {
    await b.cleanup();
  }
});
