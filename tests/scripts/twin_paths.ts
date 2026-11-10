/**
 * A path in the one spelling the script twins are compared in: `/` separators
 * (on Windows git answers `C:/x` where PowerShell says `C:\x`), `//` collapsed
 * (bash's preset glob yields `presets/a//templates`), and Git Bash's `/c/x`
 * read as `c:/x`, case folded, on Windows only.
 */
export function slashes(p: string): string {
  const s = p.replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  if (Deno.build.os !== "windows") return s;
  return s.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:").toLowerCase();
}
