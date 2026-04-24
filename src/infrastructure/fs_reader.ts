import { join } from "@std/path";
import type { FsReader } from "../application/ports.ts";

export class DenoFsReader implements FsReader {
  async readText(projectDir: string, rel: string): Promise<string | null> {
    try {
      return await Deno.readTextFile(join(projectDir, rel));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }
}
