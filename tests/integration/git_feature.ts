import { assert } from "@std/assert";

/**
 * A git feature a test needs, and whether the git on this machine has it. Where it is missing, a
 * local run skips the test with the reason in its name; CI runs it and fails, because a skip there
 * leaves the suite green with the test never run.
 */
export type GitFeature = { name: string; present: boolean };

const version = async (): Promise<[number, number]> => {
  const out = await new Deno.Command("git", { args: ["version"], stdout: "piped" }).output();
  const [major, minor] = (/(\d+)\.(\d+)/.exec(new TextDecoder().decode(out.stdout)) ?? [])
    .slice(1).map(Number);
  return [major, minor];
};
const [MAJOR, MINOR] = await version();
const atLeast = (minor: number) => MAJOR > 2 || (MAJOR === 2 && MINOR >= minor);

/** `git init --ref-format=reftable`. */
export const REFTABLE_INIT: GitFeature = { name: "git 2.45 (--ref-format)", present: atLeast(45) };
/** `git refs migrate`, which moves a repository's refs, reflogs included, to a reftable. */
export const REFS_MIGRATE: GitFeature = { name: "git 2.48 (refs migrate)", present: atLeast(48) };

/** Registers `fn` as a test that needs `feature`: skipped off CI without it, failed on CI. */
export function gitTest(feature: GitFeature, name: string, fn: () => Promise<void>): void {
  Deno.test({
    name: feature.present ? name : `${name} [needs ${feature.name}]`,
    ignore: !feature.present && Deno.env.get("CI") !== "true",
    fn: async () => {
      assert(feature.present, `this git lacks ${feature.name}, which CI must run this test with`);
      await fn();
    },
  });
}
