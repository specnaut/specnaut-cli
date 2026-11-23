import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";

/**
 * The PowerShell paths, commands and assignments built where a list of spellings cannot follow: a
 * path an item cmdlet is handed that is not a constant, an encoded command as the shell splits its
 * words, and an assignment spelled across the shell's quotes. Each names its source as not fully
 * read, through the hook the harness runs.
 */

const none = (_path: string) => false;
const hook = (command: string) =>
  new TextEncoder().encode(
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }),
  );
const whole = (command: string) => commandPaths(".claude/settings.json", hook(command), none).whole;
const unread = (commands: readonly string[]) => commands.filter(whole);

Deno.test("an item cmdlet handed a path that is not a constant is not read whole", () => {
  assertEquals(
    unread([
      'si "E$()nv$([char]58)Pa$()th" tools',
      '$d = (gdr -PSProvider Environment).Name; si "$($d):Path" tools',
      'si "$((gdr -PSProvider Environment).Name):Path" tools',
      "si env:\\Path tools",
      "si env:/Path tools",
      "si env:P*h tools",
      "$n = 'Path'; si env:$n tools",
      'Microsoft.PowerShell.Management\\Set-Item "E$()nv:Path" tools',
      'New-Item -Path ("E" + "nv:") -Name Path -Value tools',
      'Copy-Item tools -Destination "E$()nv:Path"',
      'sl ("E" + "nv:"); si Path tools',
      "Get-Item x | si -Value tools",
      "& $c E:Path tools",
      ". $s",
      "si E+x tools",
      "si [char]x tools",
      "si {x} tools",
      "si $x tools",
      "si (x) tools",
      'cd ("en"+"v:"); si Path tools',
      'cd ("en"+"v:"); si Pat* tools',
      "si .\\Path tools",
      "si ./PATH tools",
      "si 'path' tools",
      "si P?th tools",
      "si [P]ath tools",
      "$a = @(('En'+'v:Path'), 'tools'); si @a",
      "si('En'+'v:Path') tools",
      "gi ('En'+'v:Path') | si -Value tools -ea Stop",
      "gi x | & si -Value tools",
      "gi x | . si -Value tools",
      "si \u201CPath\u201D x",
      'si "Pat`h" x',
      "si @'\nPath\n'@ x",
      "si .\\.\\Path x",
      "si x/../Path tools",
    ]),
    [],
  );
  const constant = [
    "Set-Content out.txt $msg",
    "New-Item -ItemType Directory tools",
    "si x -Value $v",
    "si -Force x $v",
    'si x "$v w"',
    "Set-Content out.txt ($a + $b)",
    "Set-Content path.txt x",
    "si ./paths x",
  ];
  assertEquals(constant.filter((c) => !whole(c)), []);
});

Deno.test("an encoded command the shell's own split hands PowerShell is not read whole", () => {
  const e = "-e JABlAG4AdgA=";
  const split = [`true;pwsh ${e}`, `(pwsh ${e})`, `p''wsh ${e}`, `&pwsh ${e}`, `pwsh>log ${e}`];
  assertEquals(unread([...split, `{pwsh ${e}}`, `{p''wsh ${e}}`]), []);
  assertEquals(["pwsh -c lint -"].filter((c) => !whole(c)), []);
});

Deno.test("an assignment spelled across shell quotes is held to the value's rules", () => {
  // A shell's split hands PowerShell `$env:PATH=tools;…`: quotes glued to the value are taken off.
  assertEquals(
    unread(['$env:PATH="tools;$env:Path"; lint', "${ENV:PATH}='tools;' + ${env:Path}"]),
    [],
  );
  assertEquals(
    unread([
      "pwsh -c '$env:Path = '\"(gi evil).FullName + ';' + \"'$env:Path; lint'",
      "pwsh -c '$env:Path = ' '(gi evil).FullName'",
      "pwsh -c '$env:Path = '<#c#>\"(gi evil).FullName + ';' + \"'$env:Path; lint'",
      "pwsh -c '$env:Pa''th = (Resolve-Path tools).Path'",
      "pwsh -c '$env:Pa''th=(Get-Location).Path'",
      "pwsh -c '$env:Pa''th = (Resolve-Path tools).Path'; echo \"$env:Path = 'tools'\"",
    ]),
    [],
  );
});
