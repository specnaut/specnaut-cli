import { assert } from "@std/assert";
import * as conditionalRender from "../../src/domain/conditional_render.ts";

Deno.test("renderMarked stays module-private: its key reaches a RegExp unescaped", () => {
  // Every caller is a family in the module passing a literal key (cli#687).
  // An export would let a key with RegExp syntax in it build the wrong pattern.
  assert(!("renderMarked" in conditionalRender), "renderMarked is exported");
});
