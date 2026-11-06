/**
 * The paths a branch changed, made relative to the project's folder: what the phases' fences
 * (`.specnaut/workflow.yml`, `.specnaut/gates.yml`, `.specnaut/backlog-config.yml`) are matched
 * against, so they hold in a project nested under the repository's top as at the top. A path
 * outside the project climbs out of it with `../`.
 */
export function projectRelative(names: readonly string[], prefix: string): string[] {
  const folders = prefix.split("/").filter(Boolean);
  return names.map((name) => {
    const parts = name.split("/");
    let shared = 0;
    while (
      shared < folders.length && shared < parts.length - 1 && parts[shared] === folders[shared]
    ) {
      shared++;
    }
    return [...Array(folders.length - shared).fill(".."), ...parts.slice(shared)].join("/");
  });
}
