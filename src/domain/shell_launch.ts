import { psOption } from "./powershell_options.ts";

/**
 * What a shell a command starts runs, read from its options as each shell reads them: the code it
 * is handed (`bash -c '…'`, `pwsh -Command …`, `cmd /c …`), or whether it reads its code from its
 * input (no script, `-s`, `-`, `/dev/stdin`). An option this reading does not know is taken to
 * consume the word after it, so a script it cannot place is the shell's input, never a file read
 * whole (`assembled_code.ts`).
 */

/** A shell, by the base name of the word that starts it, its `.exe` and letter case aside. */
const SHELL = /^(?:(?:ba|z|da|k|mk|y|c|tc|fi|a)?sh\d*|pwsh|powershell|cmd|busybox|nu)$/;

/** The shell `word` starts, or `undefined`. */
export function shellOf(word: string): string | undefined {
  const base = word.slice(Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\")) + 1);
  const name = base.toLowerCase().replace(/\.exe$/, "");
  return SHELL.test(name) ? name : undefined;
}

/** What a shell is started to run: the code it is handed, and whether it reads its input. */
export type Launch = { readonly code?: string; readonly stdin: boolean };

export function launch(shell: string, rest: readonly string[]): Launch {
  if (shell === "pwsh" || shell === "powershell") return psLaunch(rest, shell === "powershell");
  if (shell === "cmd") return cmdLaunch(rest);
  if (shell === "busybox") return { stdin: rest.length === 0 };
  return posixLaunch(rest, shell === "nu");
}

/** A script operand naming the shell's input. */
const STDIN = /^(?:-|\/dev\/stdin|\/dev\/fd\/.*)$/;

/**
 * A POSIX shell's or fish's or nu's options and script: `-c` (in a cluster, `-lc`), `-C`,
 * `--command` or `--init-command` hand it code, `-s` or `--stdin` its input; `-o` and `-O` take a
 * value, as do `--rcfile` and `--init-file`, and every nu option but `-c`. The first word after
 * them is the code or the script; none is the shell's input.
 */
function posixLaunch(rest: readonly string[], nu: boolean): Launch {
  let [code, stdin, at] = [false, false, 0];
  for (; at < rest.length; at++) {
    const word = rest[at];
    if (word === "--") {
      at++;
      break;
    }
    const long = /^--([\w-]+)(=.*)?$/s.exec(word);
    if (long !== null) {
      const handsCode = /^(?:command|commands|init-command)$/.test(long[1]);
      if (handsCode && long[2] !== undefined) return { code: long[2].slice(1), stdin };
      code ||= handsCode;
      stdin ||= long[1] === "stdin";
      if (!handsCode && long[2] === undefined && (nu || /^(?:rcfile|init-file)$/.test(long[1]))) {
        at++;
      }
    } else if (/^[-+]\w/.test(word)) {
      const letters = word.slice(1);
      code ||= /c/i.test(letters);
      stdin ||= letters.includes("s");
      if (nu ? !/c/i.test(letters) : /[oO]$/.test(letters)) at++;
    } else break;
  }
  const operand = rest[at];
  if (code) return { code: operand ?? "", stdin };
  return { stdin: stdin || operand === undefined || STDIN.test(operand) };
}

/** The PowerShell launcher's switches, which take no value; every other option takes one. */
const PS_SWITCHES = `noprofile nologo noninteractive noexit interactive login mta sta
  noprofileloadtime sshservermode help`.split(/\s+/);
const psSwitch = (word: string) => {
  const option = word.slice(1).toLowerCase();
  return ["?", "h", "i", "l"].includes(option) ||
    (option.length >= 2 && PS_SWITCHES.some((s) => s.startsWith(option)));
};

/**
 * PowerShell's options and script (`psOption`): `-Command` hands it the rest of the line as code,
 * `-` its input; `-File` a script, `-` its input; a first word that is no option is a script for
 * `pwsh` and code for Windows PowerShell (`powershell`). No script is its input.
 */
function psLaunch(rest: readonly string[], positionalCode: boolean): Launch {
  for (let at = 0; at < rest.length; at++) {
    const word = rest[at];
    const glued = word.includes(":") ? [word.slice(word.indexOf(":") + 1)] : [];
    if (psOption(word, "command")) {
      const code = [...glued, ...rest.slice(at + 1)].join(" ").trim();
      return { code, stdin: code === "-" || code === "" };
    }
    if (psOption(word, "file")) {
      const file = glued[0] ?? rest[at + 1];
      return { stdin: file === undefined || file === "-" };
    }
    if (psOption(word, "encodedcommand")) return { stdin: false };
    if (!/^[-/–—―]/.test(word)) {
      const code = positionalCode ? rest.slice(at).join(" ") : undefined;
      return { code, stdin: word === "-" };
    }
    if (!psSwitch(word)) at++;
  }
  return { stdin: true };
}

/** `cmd`'s `/c` or `/k` hands it the rest of the line as code; without either it reads its input. */
function cmdLaunch(rest: readonly string[]): Launch {
  for (let at = 0; at < rest.length && rest[at].startsWith("/"); at++) {
    if (/^\/[ck]/i.test(rest[at])) {
      return { code: [rest[at].slice(2), ...rest.slice(at + 1)].join(" "), stdin: false };
    }
  }
  return { stdin: true };
}
