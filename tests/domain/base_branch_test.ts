import { assertEquals } from "@std/assert";
import {
  baseAnchorRef,
  branchOfOriginHead,
  plainBranchName,
} from "../../src/domain/base_branch.ts";

Deno.test("a plain branch name passes; an option, a range or an odd first character does not", () => {
  for (const name of ["main", "trunk", "release/1.0", "feat_x-2"]) {
    assertEquals(plainBranchName(name), name);
  }
  for (const name of ["", "-x", "--exec=x", "a..b", ".hidden", "a b", "a~1", "/main"]) {
    assertEquals(plainBranchName(name), null, name);
  }
});

Deno.test("origin/HEAD's target names the branch only under refs/remotes/origin/", () => {
  assertEquals(branchOfOriginHead("refs/remotes/origin/main"), "main");
  assertEquals(branchOfOriginHead("refs/remotes/origin/team/trunk"), "team/trunk");
  assertEquals(branchOfOriginHead("refs/heads/main"), null);
  assertEquals(branchOfOriginHead("refs/remotes/origin/--x"), null);
});

Deno.test("the base is read at origin's copy when there is an origin, the local branch otherwise", () => {
  assertEquals(baseAnchorRef("main", true), "refs/remotes/origin/main");
  assertEquals(baseAnchorRef("main", false), "refs/heads/main");
});
