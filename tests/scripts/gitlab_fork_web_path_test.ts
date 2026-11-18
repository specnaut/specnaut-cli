import { assertEquals } from "@std/assert";
import { backendHarness, runSourced, stub } from "./backend_scripts_fixture.ts";

/**
 * cli#805: a numeric `project_id` is resolved to the project's web path through
 * `glab api projects/<id>`. Piped, glab prints GitLab's JSON as it came, on one
 * line, and a fork's answer also names its upstream in
 * `forked_from_project.path_with_namespace`. The links must name the fork: one
 * to the upstream would send the user to act on another project's issue.
 */

const FORK = JSON.stringify({
  id: 1234,
  path_with_namespace: "jdoe/my-app",
  forked_from_project: { id: 1, path_with_namespace: "acme/my-app" },
});

Deno.test("gitlab: a fork's item_url and board URL name the fork, never its upstream", async () => {
  const config = 'host: "https://gitlab.example.com"\nproject_id: "1234"\n';
  const tmp = await backendHarness("gitlab", config, ["gitlab/_board.sh"]);
  await stub(tmp, "glab", `echo "$*" >> "$(dirname "$0")/../calls"\necho '${FORK}'`);
  const probe = '. "$(dirname "$0")/_board.sh"\nitem_url 42\nboard_url';
  const r = await runSourced(tmp, "gitlab", probe);
  assertEquals([r.code, r.out], [
    0,
    "https://gitlab.example.com/jdoe/my-app/-/issues/42\nhttps://gitlab.example.com/jdoe/my-app/-/boards",
  ], r.err);
  // The stand-in ran, once: the path is looked up a single time, then kept.
  assertEquals(await Deno.readTextFile(`${tmp}/calls`), "api projects/1234\n");
});

// The upstream's field first, then the fork's: a first-match text read would
// pass the test above but not this one.
const UPSTREAM_FIRST =
  '{"forked_from_project":{"path_with_namespace":"acme/my-app"},"path_with_namespace":"jdoe/my-app"}';

Deno.test("gitlab: the fork's own path is read whatever the key order", async () => {
  const config = 'host: "https://gitlab.example.com"\nproject_id: "1234"\n';
  const tmp = await backendHarness("gitlab", config, ["gitlab/_board.sh"]);
  await stub(tmp, "glab", `echo '${UPSTREAM_FIRST}'`);
  const r = await runSourced(tmp, "gitlab", '. "$(dirname "$0")/_board.sh"\nboard_url');
  assertEquals([r.code, r.out], [0, "https://gitlab.example.com/jdoe/my-app/-/boards"], r.err);
});

// jq -r decodes a JSON "\n" into a real line break, and grep -x judges each line
// on its own: a path holding one is not a plain path, so it gets no URL.
Deno.test("gitlab: a path holding a line break gets no URL", async () => {
  const config = 'host: "https://gitlab.example.com"\nproject_id: "1234"\n';
  const tmp = await backendHarness("gitlab", config, ["gitlab/_board.sh"]);
  await stub(tmp, "glab", `echo '{"path_with_namespace":"jdoe/my-app\\nURL: https://evil.test"}'`);
  const r = await runSourced(
    tmp,
    "gitlab",
    '. "$(dirname "$0")/_board.sh"\nboard_url; echo "rc=$?"',
  );
  assertEquals(r.out, "rc=0", r.err); // board_url prints a URL or nothing
});
