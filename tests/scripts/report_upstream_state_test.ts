import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { box, CREATED, createLines, ISSUE_99, REPORT } from "./report_upstream_fixture.ts";

/**
 * cli#726: what the script keeps on disk between the ask and the create: where it
 * may not write, who the report was prepared for, the marker that stops a second
 * create, and how long a declined report stays. And what it does when a scan's
 * grep cannot answer.
 */

const WINDOWS = Deno.build.os === "windows";
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

/** Root writes through any mode: there, a mode proves nothing and the case is skipped. */
async function modesApply(dir: string): Promise<boolean> {
  const probe = join(dir, "probe");
  const wrote = await Deno.writeTextFile(probe, "").then(() => true, () => false);
  if (wrote) await Deno.remove(probe);
  return !wrote;
}

async function assertStorageRefused(b: Awaited<ReturnType<typeof box>>) {
  const search = await b.run(["search"], "upgrade crash\n");
  assertEquals(search.stdout, "REFUSED storage\n");
  const prepare = await b.run(["prepare", "--kind", "bug"], REPORT);
  assertEquals(prepare.stdout, "REFUSED storage\n");
  assertEquals(prepare.code, 3);
  assertEquals(await b.log(), "", "a refused report contacted someone");
}

Deno.test("REFUSED storage: ~/.specnaut is a file", async () => {
  const b = await box();
  try {
    await Deno.writeTextFile(join(b.sb.home, ".specnaut"), "");
    await assertStorageRefused(b);
  } finally {
    await b.cleanup();
  }
});

Deno.test({
  name: "REFUSED storage: an unwritable HOME, as in a workspace-write sandbox",
  ignore: WINDOWS,
  fn: async () => {
    const b = await box();
    try {
      await Deno.chmod(b.sb.home, 0o555);
      if (await modesApply(b.sb.home)) await assertStorageRefused(b);
    } finally {
      await Deno.chmod(b.sb.home, 0o755);
      await b.cleanup();
    }
  },
});

Deno.test({
  name: "REFUSED storage: an unwritable reports directory that already exists",
  ignore: WINDOWS,
  fn: async () => {
    const b = await box();
    try {
      const reports = join(b.sb.home, ".specnaut", "reports");
      await Deno.mkdir(reports, { recursive: true });
      await Deno.chmod(reports, 0o500);
      if (await modesApply(reports)) {
        const r = await b.run(["prepare", "--kind", "bug"], REPORT);
        assertEquals(r.stdout, "REFUSED storage\n");
      }
      await Deno.chmod(reports, 0o700);
    } finally {
      await b.cleanup();
    }
  },
});

Deno.test({
  name: "REFUSED storage: a symlinked ~/.specnaut, from every command that uses it",
  ignore: WINDOWS,
  fn: async () => {
    const b = await box();
    try {
      const digest = await b.prepared();
      const real = join(b.sb.dir, "moved");
      await Deno.rename(join(b.sb.home, ".specnaut"), real);
      await Deno.symlink(real, join(b.sb.home, ".specnaut"));
      await Deno.writeTextFile(join(b.sb.dir, "log"), "");
      for (const sub of ["create", "link"]) {
        assertEquals((await b.run([sub, digest], "", CREATED)).stdout, "REFUSED storage\n", sub);
      }
      await assertStorageRefused(b);
    } finally {
      await b.cleanup();
    }
  },
});

Deno.test("a temp file comes from mktemp in the reports directory: failing it stores nothing", async () => {
  const b = await box();
  try {
    await b.shim("mktemp", "exit 1");
    assertEquals((await b.run(["prepare", "--kind", "bug"], REPORT)).stdout, "REFUSED storage\n");
    assertEquals((await b.run(["search"], "upgrade\n")).stdout, "REFUSED storage\n");
  } finally {
    await b.cleanup();
  }
});

Deno.test("create refuses when gh now posts as another login than was prepared for", async () => {
  const b = await box();
  try {
    const digest = await b.prepared();
    const r = await b.run(["create", digest], "", { ...CREATED, STUB_LOGIN: "someone-else" });
    assertEquals(r.stdout, "REFUSED identity\n");
    assertEquals(r.code, 3);
    assertEquals(createLines(await b.log()), []);

    await Deno.remove(b.reportPath(digest).replace(/\.md$/, ".login"));
    assertEquals((await b.run(["create", digest], "", CREATED)).stdout, "REFUSED identity\n");
    assertEquals(createLines(await b.log()), []);

    await b.prepared();
    assertStringIncludes((await b.run(["create", digest], "", CREATED)).stdout, "CREATED ");
  } finally {
    await b.cleanup();
  }
});

Deno.test("two runs past the check: the marker is exclusive, and one creates", async () => {
  const b = await box();
  try {
    const digest = await b.prepared();
    const marker = b.reportPath(digest).replace(/\.md$/, ".sent");
    const r = await b.run(["create", digest], "", { ...CREATED, STUB_RACE_FILE: bashPath(marker) });
    assertEquals(r.stdout, "CREATED unverified\n");
    assertEquals(r.code, 5);
    assertEquals(createLines(await b.log()), [], "the second run created anyway");
  } finally {
    await b.cleanup();
  }
});

Deno.test("preparing the same bytes after a create keeps the URL: one create, the first URL", async () => {
  const b = await box();
  try {
    const digest = await b.prepared();
    assertStringIncludes((await b.run(["create", digest], "", CREATED)).stdout, ISSUE_99);
    assertEquals(await b.prepared(), digest);
    const again = await b.run(["create", digest], "", {
      STUB_CREATE_OUT: "https://github.com/specnaut/specnaut-cli/issues/100",
      STUB_VIEW_OUT: "99\\n",
    });
    assertStringIncludes(again.stdout, `CREATED ${ISSUE_99}\nISSUE ok\n`);
    assertEquals(createLines(await b.log()).length, 1);
  } finally {
    await b.cleanup();
  }
});

Deno.test("prepare deletes unsent reports older than a day, and nothing else", async () => {
  const b = await box();
  try {
    const old = await b.prepared("Declined\n\nA body.\n");
    const sent = await b.prepared("Sent\n\nA body.\n");
    const fresh = await b.prepared("Fresh\n\nA body.\n");
    await b.run(["create", sent], "", CREATED);
    const twoDays = Date.now() / 1000 - 172800;
    for (const d of [old, sent]) await Deno.utime(b.reportPath(d), twoDays, twoDays);

    await b.prepared();

    assertEquals(await exists(b.reportPath(old)), false, "the declined report stayed");
    assertEquals(await exists(b.reportPath(old).replace(/\.md$/, ".login")), false);
    assertEquals(await exists(b.reportPath(sent)), true, "a sent report was deleted");
    assertEquals(await exists(b.reportPath(fresh)), true, "a fresh report was deleted");
  } finally {
    await b.cleanup();
  }
});

/** A pattern each scan alone holds, and the refusal it owes when grep cannot answer. */
const SCANS: ReadonlyArray<[string, string]> = [
  ["<!--", "hidden"],
  ["-----BEGIN", "secret"],
  ["credential", "secret"],
  ["(bearer|basic)", "secret"],
  ["-iwF", "literal"],
  ["192", "addressing"],
  ["://[^[:space:]]+", "addressing"],
  ["internal|local", "addressing"],
  ["&#])#", "addressing"],
];

for (const [pattern, cls] of SCANS) {
  Deno.test(`a grep that fails on ${pattern} refuses as ${cls}, and stores nothing`, async () => {
    const b = await box();
    try {
      await b.shim(
        "grep",
        `case "$*" in *${
          JSON.stringify(pattern)
        }*) exit 2 ;; esac\nPATH=\${PATH#*:} exec grep "$@"`,
      );
      const r = await b.run(["prepare", "--kind", "bug"], "A title\n\nplain words\n");
      assertEquals(r.stdout, `REFUSED ${cls}\n`);
      assertEquals(await b.log(), "");
    } finally {
      await b.cleanup();
    }
  });
}
