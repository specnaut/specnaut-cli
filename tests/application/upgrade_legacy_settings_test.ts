import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { carryLegacySettings } from "../../src/application/upgrade_legacy_settings.ts";
import {
  GATE_CONFIG_PATHS,
  SIZE_LIMITS_CONFIG_PATH,
  UI_CONFIG_PATH,
} from "../../src/domain/constitution_paths.ts";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";

/**
 * Spec 038, FR-010 and S5: the carry writes a config only where nothing is,
 * through the writer, and never through a link — with the real adapters, since
 * a link is exactly what a fake cannot model.
 */

const HEADING = "## Size" + " limits";
const OLD = `# Acme\n\n${HEADING}\n\n| Unit | Target | Ceiling |\n| :--- | ---: | ---: |\n` +
  "| file | 250 | 400 |\n\n## Front-end patterns\n\n### Target surface\n\n" +
  "This project targets desktop viewports only.\n";

async function project(fn: (dir: string, outside: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-carry-" });
  const outside = await Deno.makeTempDir({ prefix: "specnaut-outside-" });
  try {
    await Deno.mkdir(join(dir, ".specnaut"), { recursive: true });
    await fn(dir, outside);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
}

const io = (projectDir: string, dryRun = false) => ({
  reader: new DenoFsReader(),
  writer: new DenoFsWriter(),
  projectDir,
  dryRun,
});

Deno.test("a customised table and declaration are written, and the stale sections named", async () => {
  await project(async (dir) => {
    const notes = await carryLegacySettings(io(dir), OLD);
    assertEquals(
      await Deno.readTextFile(join(dir, SIZE_LIMITS_CONFIG_PATH)),
      "file:\n  target: 250\n  ceiling: 400\n",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, UI_CONFIG_PATH)),
      'target_surface: "desktop viewports only"\n',
    );
    assertEquals(notes.length, 2);
    for (const n of notes) assertStringIncludes(n, "can be deleted");
  });
});

Deno.test("a config already there is the project's: never rewritten, nothing said", async () => {
  await project(async (dir) => {
    await Deno.writeTextFile(join(dir, SIZE_LIMITS_CONFIG_PATH), "# ours\n");
    await Deno.writeTextFile(join(dir, UI_CONFIG_PATH), "# ours\n");
    assertEquals(await carryLegacySettings(io(dir), OLD), []);
    assertEquals(await Deno.readTextFile(join(dir, SIZE_LIMITS_CONFIG_PATH)), "# ours\n");
  });
});

Deno.test("a dangling link at each config path: nothing is created outside the project", async () => {
  await project(async (dir, outside) => {
    for (const [i, rel] of GATE_CONFIG_PATHS.entries()) {
      await Deno.symlink(join(outside, `target-${i}.yml`), join(dir, rel));
    }
    assertEquals(await carryLegacySettings(io(dir), OLD), []);
    assertEquals([...Deno.readDirSync(outside)], []);
    for (const rel of GATE_CONFIG_PATHS) {
      assertEquals((await Deno.lstat(join(dir, rel))).isSymlink, true, rel);
    }
  });
});

Deno.test("a dry run writes nothing and says what it would write", async () => {
  await project(async (dir) => {
    const notes = await carryLegacySettings(io(dir, true), OLD);
    assertEquals(notes.length, 2);
    for (const n of notes) assertStringIncludes(n, "would write");
    assertEquals(await exists(join(dir, SIZE_LIMITS_CONFIG_PATH)), false);
    assertEquals(await exists(join(dir, UI_CONFIG_PATH)), false);
  });
});

Deno.test("a refused value is said and written nowhere; a default table says nothing", async () => {
  await project(async (dir) => {
    const bad = OLD.replace("| file | 250 | 400 |", "| file | 25O | 400 |");
    const [note, ...rest] = await carryLegacySettings(io(dir), bad);
    assertStringIncludes(note, "is not carried to .specnaut/size-limits.yml");
    assertStringIncludes(note, "'25O'");
    assertEquals(rest.length, 1, "the declaration is still carried");
    assertEquals(await exists(join(dir, SIZE_LIMITS_CONFIG_PATH)), false);
    assertEquals(await carryLegacySettings(io(dir), "# Acme\n"), []);
    assertEquals(await carryLegacySettings(io(dir), null), []);
  });
});

Deno.test("a link planted after the check is not written through, even inside the project", async () => {
  await project(async (dir) => {
    // The check saw nothing; by the write, a link pointing inside is there.
    await Deno.symlink(join(dir, "elsewhere.yml"), join(dir, UI_CONFIG_PATH));
    const real = new DenoFsReader();
    const blind = {
      ...io(dir),
      reader: {
        readText: (d: string, rel: string) => real.readText(d, rel),
        readEntry: () => Promise.resolve(null),
      },
    };
    const notes = await carryLegacySettings(blind, OLD.replace(/## Size[\s\S]*?(?=## Front)/, ""));
    assertEquals(await exists(join(dir, "elsewhere.yml")), false);
    assertStringIncludes(notes[0], `${UI_CONFIG_PATH} is not written: something is already there`);
  });
});
