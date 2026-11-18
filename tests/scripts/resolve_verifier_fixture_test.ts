import { assertEquals } from "@std/assert";
import { spawnWith } from "./resolve_verifier_fixture.ts";

/** A hook that refuses may exit before it reads its stdin: the call still reports its exit. */
Deno.test({
  name: "a program that exits without reading its input still reports its exit",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const big = "x".repeat(1 << 20);
    assertEquals(await spawnWith(["/bin/sh", "-c", "exit 2"], "/", {}, big), {
      code: 2,
      stderr: "",
    });
  },
});
