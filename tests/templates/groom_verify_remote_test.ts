import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { FULL_BODY, project } from "./groom_sandbox.ts";

/**
 * US4 / FR-005 — the GitHub, GitLab and Cloud `groom-verify.sh`, each run for
 * real against a stub of the CLI it calls (`gh`, `glab`, `curl`). What is
 * asserted is what each normaliser hands `groom-rules.sh`, read back through
 * the rules' verdict.
 */

const GH_CONFIG = "repo: acme/widget\nproject_number: 7\n";

/** One `issue(number:)` GraphQL answer, the shape `gh api graphql` returns. */
function ghIssue(o: {
  body?: string;
  state?: string;
  stateReason?: string | null;
  labels?: string[];
  comments?: string[];
  items?: Array<{ number: number; owner?: string; fields: Record<string, string> }>;
}) {
  return {
    data: {
      repository: {
        issue: {
          body: o.body ?? FULL_BODY,
          state: o.state ?? "OPEN",
          stateReason: o.stateReason ?? null,
          labels: { nodes: (o.labels ?? []).map((name) => ({ name })) },
          comments: { nodes: (o.comments ?? []).map((body) => ({ body })) },
          projectItems: {
            nodes: (o.items ?? []).map((it) => ({
              project: { number: it.number, owner: { login: it.owner ?? "acme" } },
              fieldValues: {
                nodes: [
                  {},
                  ...Object.entries(it.fields).map(([field, name]) => ({
                    name,
                    field: { name: field },
                  })),
                ],
              },
            })),
          },
        },
      },
    },
  };
}

/** `gh api graphql … -F num=<n>` answers with $FIXTURES/gh-<n>.json; a missing file fails like gh. */
const GH_STUB = `
num=""
for a in "$@"; do case "$a" in num=*) num="\${a#num=}" ;; esac; done
[ "$1 $2" = "api graphql" ] && [ -f "$FIXTURES/gh-$num.json" ] || { echo "gh: stub has no answer for $*" >&2; exit 1; }
cat "$FIXTURES/gh-$num.json"
`;

Deno.test("github: native fields, label fallback, the project's own item only", async () => {
  const p = await project("github", [], GH_CONFIG);
  try {
    await p.stub("gh", GH_STUB);
    const put = (n: number, v: unknown) =>
      Deno.writeTextFile(join(p.dir, `gh-${n}.json`), JSON.stringify(v));
    // 1: native fields, in Ready.
    await put(
      1,
      ghIssue({ items: [{ number: 7, fields: { Status: "Ready", Priority: "P1", Size: "M" } }] }),
    );
    // 2: label fallback for priority (a 3-level field has no P3), clarify comment.
    await put(
      2,
      ghIssue({
        labels: ["bug", "priority:P3"],
        comments: ["thanks", "🤖 specnaut-groom — which tenant?"],
        items: [{ number: 7, fields: { Status: "Backlog", Size: "S" } }],
      }),
    );
    // 3: field and a disagreeing label — two sizes; values on ANOTHER project ignored.
    await put(
      3,
      ghIssue({
        labels: ["size:L"],
        items: [
          { number: 3, fields: { Status: "Ready", Priority: "P0", Size: "XS" } },
          { number: 7, owner: "someone-else", fields: { Status: "Ready", Priority: "P0" } },
          { number: 7, fields: { Status: "Ready", Priority: "P2", Size: "M" } },
        ],
      }),
    );
    // 4: not on the project at all, closed as not planned.
    await put(
      4,
      ghIssue({ state: "CLOSED", stateReason: "NOT_PLANNED", labels: ["size:XL", "priority:P3"] }),
    );
    // 5: on another project only: its Ready and its fields are not this board's.
    await put(
      5,
      ghIssue({ items: [{ number: 3, fields: { Status: "Ready", Priority: "P1", Size: "M" } }] }),
    );

    let r = await p.verify("1", "2", "4");
    assertEquals([r.code, r.stdout], [0, ""], r.stderr);

    r = await p.verify("3", "5");
    assertEquals(r.code, 1, r.stderr);
    const lines = r.stdout.trim().split("\n");
    assertEquals(lines[0], "#3: missing size (2 values: L, M)");
    assertStringIncludes(
      lines[1],
      "#5: missing size (none); priority (none); outcome (not in Ready",
    );

    r = await p.verify("--ready", "Groomed", "1");
    assertStringIncludes(r.stdout, "not in Groomed");

    // gh failing for one item: exit 2, and nothing reported as complete.
    r = await p.verify("1", "99");
    assertEquals([r.code, r.stdout], [2, ""], r.stderr);
    assertStringIncludes(r.stderr, "#99");

    // A jq that writes CRLF (its Windows build): the verdict is the same text,
    // not "#3: … L, M\r".
    await p.crlfJq();
    r = await p.verify("3", "5");
    assertEquals(r.stdout.split("\n")[0], "#3: missing size (2 values: L, M)");
  } finally {
    await p.cleanup();
  }
});

// ---- gitlab ------------------------------------------------------------------

const GL_CONFIG = "host: https://gitlab.example.com\nproject_id: acme/widget\n";

/** `glab issue view <n>` → $FIXTURES/gl-<n>.json; `glab api …/issues/<n>/notes…` → gl-<n>-notes.json. */
const GL_STUB = `
case "$1 $2" in
  "issue view") f="$FIXTURES/gl-$3.json" ;;
  api*) n="\${2#*issues/}"; n="\${n%%/*}"; f="$FIXTURES/gl-$n-notes.json"
        case "$2" in projects/acme%2Fwidget/*) ;; *) echo "glab: unencoded project in $2" >&2; exit 1 ;; esac ;;
  *) f="" ;;
esac
[ -n "$f" ] && [ -f "$f" ] || { echo "glab: stub has no answer for $*" >&2; exit 1; }
cat "$f"
`;

Deno.test("gitlab: scoped labels, notes without system notes, no close reason", async () => {
  const p = await project("gitlab", [], GL_CONFIG);
  try {
    await p.stub("glab", GL_STUB);
    const put = (name: string, v: unknown) =>
      Deno.writeTextFile(join(p.dir, `${name}.json`), JSON.stringify(v));
    const issue = (labels: string[], state = "opened") => ({
      iid: 1,
      description: FULL_BODY,
      labels,
      state,
    });
    await put("gl-1", issue(["Status::Ready", "priority::P1", "size::M", "type::feature"]));
    await put("gl-1-notes", []);
    await put("gl-2", issue(["Status::Backlog", "priority::P2", "size::S"]));
    await put("gl-2-notes", [{ body: "🤖 specnaut-groom — which tenant?", system: false }]);
    // A system note quoting the marker is GitLab's, not the groom's.
    await put("gl-3", issue(["Status::Backlog", "priority::P2", "size::S"]));
    await put("gl-3-notes", [{ body: "🤖 specnaut-groom added label", system: true }]);
    // Closed: GitLab records no close reason, so closing proves nothing.
    await put("gl-4", issue(["priority::P3", "size::XS"], "closed"));
    await put("gl-4-notes", []);

    let r = await p.verify("1", "2");
    assertEquals([r.code, r.stdout], [0, ""], r.stderr);

    r = await p.verify("3", "4");
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stdout, "#3: missing outcome");
    assertStringIncludes(r.stdout, "#4: missing outcome");

    // A jq that writes CRLF (its Windows build) still names the project
    // `acme%2Fwidget`, never `acme%2Fwidget\r`, which the stub refuses.
    await p.crlfJq();
    r = await p.verify("1", "2");
    assertEquals([r.code, r.stdout], [0, ""], r.stderr);
    // On Windows crlfJq installs no stub: the real jq.exe already writes CRLF.
    if (Deno.build.os !== "windows") await Deno.remove(join(p.dir, "bin", "jq"));

    r = await p.verify("1", "5");
    assertEquals([r.code, r.stdout], [2, ""]);
  } finally {
    await p.cleanup();
  }
});

// ---- cloud -------------------------------------------------------------------

const CLOUD_CONFIG = "backend: cloud\napi_url: https://api.example.com\nproject_key: ACME\n";

/** `curl … /columns…` → cloud-columns.json; `curl … /tasks…&number=<n>` → cloud-<n>.json. */
const CURL_STUB = `
url=""
for a in "$@"; do case "$a" in https://*) url="$a" ;; esac; done
case "$url" in
  */columns\\?*) f="$FIXTURES/cloud-columns.json" ;;
  */tasks\\?*number=*) f="$FIXTURES/cloud-\${url##*number=}.json" ;;
  *) f="" ;;
esac
[ -n "$f" ] && [ -f "$f" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
cat "$f"
`;

Deno.test("cloud: the wire's lower-case values, the column by id, comments unreadable", async () => {
  const p = await project("cloud", [], CLOUD_CONFIG);
  try {
    await p.stub("specnaut", 'echo "tok"');
    await p.stub("curl", CURL_STUB);
    const put = (name: string, v: unknown) =>
      Deno.writeTextFile(join(p.dir, `${name}.json`), JSON.stringify(v));
    await put("cloud-columns", {
      columns: [{ id: "c1", name: "Backlog" }, { id: "c2", name: "Ready" }],
    });
    await put("cloud-1", {
      task: { number: 1, body: FULL_BODY, priority: "p1", size: "m", columnId: "c2" },
    });
    await put("cloud-2", { task: { number: 2, body: FULL_BODY, priority: "p2", columnId: "c1" } });
    await put("cloud-3", { task: null });

    let r = await p.verify("1");
    assertEquals([r.code, r.stdout], [0, ""], r.stderr);

    r = await p.verify("2");
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(
      r.stdout,
      "#2: missing size (none); outcome (not in Ready, comments unreadable",
    );

    for (const n of ["3", "4"]) {
      r = await p.verify("1", n);
      assertEquals([r.code, r.stdout], [2, ""], `#${n}: ${r.stderr}`);
    }
  } finally {
    await p.cleanup();
  }
});
