import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { openCappedLog } from "../../src/infrastructure/capped_log.ts";

const enc = (s: string) => new TextEncoder().encode(s);

Deno.test("both streams land in one file, controls dropped, cut at the cap and said so", async () => {
  const dir = await Deno.makeTempDir({ prefix: "capped-log-" });
  try {
    const path = join(dir, "run.log");
    const log = await openCappedLog(path, 8);
    const [out, err] = [log.out.getWriter(), log.err.getWriter()];
    await out.write(enc("ok\u001b\n"));
    await err.write(enc("bad\r\nmore"));
    await log.close();
    assertEquals(await Deno.readTextFile(path), "ok\nbad\nm\n[output cut at 8 bytes]\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a log is never written over a file or through a link already at its path", async () => {
  const dir = await Deno.makeTempDir({ prefix: "capped-log-" });
  try {
    const path = join(dir, "run.log");
    await Deno.writeTextFile(path, "kept");
    await assertRejects(() => openCappedLog(path), Deno.errors.AlreadyExists);
    assertEquals(await Deno.readTextFile(path), "kept");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
