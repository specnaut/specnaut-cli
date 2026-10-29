import { join } from "@std/path";
import type { CheckOutcome } from "../domain/check_result.ts";
import { CONSTITUTION_PATH, SIZE_LIMITS_CONFIG_PATH } from "../domain/constitution_paths.ts";
import {
  constitutionCeilingNote,
  constitutionOverCeiling,
  sizeConfigFromEntry,
  sizeConfigUnreadableNote,
} from "../domain/size_limits.ts";
import { DenoFsReader } from "./fs_reader.ts";

/**
 * The `check --project` row for the team's constitution at `docs/constitution.md`
 * (spec 038). Missing is a fail — `upgrade` writes the bootstrap. An empty or
 * placeholder file, one over its ceiling (the `constitution` unit of
 * `.specnaut/size-limits.yml`), and a config the ratchet cannot read, warn:
 * the project works, the document every session loads does not do its job.
 *
 * Out of `fs_project_inspector.ts`, which sits at its size target.
 */
export async function checkConstitution(projectDir: string): Promise<CheckOutcome> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(projectDir, CONSTITUTION_PATH));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    return {
      name: "constitution",
      status: "fail",
      message: `missing ${CONSTITUTION_PATH} — run 'specnaut upgrade'`,
    };
  }
  if (isEmptyPlaceholderConstitution(text)) {
    return {
      name: "constitution",
      status: "warn",
      message: `placeholder — edit ${CONSTITUTION_PATH}`,
    };
  }
  const config = sizeConfigFromEntry(
    await new DenoFsReader().readEntry(projectDir, SIZE_LIMITS_CONFIG_PATH),
  );
  if (config.kind === "unreadable") {
    return {
      name: "constitution",
      status: "warn",
      message: sizeConfigUnreadableNote(config.reason),
    };
  }
  const over = constitutionOverCeiling(text, config.limits.units.constitution);
  if (over !== null) {
    return { name: "constitution", status: "warn", message: constitutionCeilingNote(over) };
  }
  return { name: "constitution", status: "pass", message: "populated" };
}

/** A file written before the bootstrap shipped principles, or emptied since. */
function isEmptyPlaceholderConstitution(text: string): boolean {
  return text.includes("(none defined yet)") || text.trim().length === 0;
}
