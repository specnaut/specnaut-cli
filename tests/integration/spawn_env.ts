/**
 * The Deno cache this run uses, for a child spawned with a cleared environment or a
 * moved HOME: without it the child looks elsewhere and re-downloads its dependencies.
 */
export const DENO_DIR: string = JSON.parse(
  new TextDecoder().decode(
    (await new Deno.Command("deno", { args: ["info", "--json"], stdout: "piped", stderr: "null" })
      .output()).stdout,
  ),
).denoDir;
