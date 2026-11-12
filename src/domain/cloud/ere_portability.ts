// The credential patterns are POSIX ERE, run by grep in the C locale and, translated,
// by JavaScript's RegExp. Some ERE spellings mean something else to JavaScript, so a
// pattern using one would be refused by one reader and let through by the other. This
// refuses them outright, before either pattern is compiled.

/**
 * Throws when `ere` uses a spelling grep and JavaScript read differently: a `]` first
 * in a bracket (`[]x]`, `[^]x]`: a literal in ERE, an empty class in JavaScript), a
 * backslash in a bracket (a literal in ERE, an escape in JavaScript), a collating
 * element or an equivalence class (`[.x.]`, `[=x=]`), any POSIX class but
 * `[:space:]`, the word bounds `\<` and `\>`, a bound with no minimum (`{,n}`), or a
 * bracket never closed.
 */
export function assertPortable(name: string, ere: string): void {
  const refuse = (what: string): never => {
    throw new Error(`${name} uses ${what}, which grep and the binary read differently`);
  };
  for (let i = 0; i < ere.length; i++) {
    if (ere[i] === "\\") {
      if (ere[i + 1] === "<" || ere[i + 1] === ">") refuse(`\\${ere[i + 1]}`);
      i++;
    } else if (ere[i] === "{" && ere[i + 1] === ",") refuse("{,n}");
    else if (ere[i] === "[") i = bracketEnd(ere, i, refuse);
  }
}

/** The index of the `]` closing the bracket opened at `open`. */
function bracketEnd(ere: string, open: number, refuse: (what: string) => never): number {
  let i = open + 1;
  if (ere[i] === "^") i++;
  if (ere[i] === "]") refuse("a ] first in a bracket");
  for (; i < ere.length; i++) {
    if (ere[i] === "]") return i;
    if (ere[i] === "\\") refuse("a backslash in a bracket");
    if (ere[i] === "[" && ".=:".includes(ere[i + 1] ?? "]")) {
      const close = ere.indexOf(`${ere[i + 1]}]`, i + 2);
      const item = close < 0 ? ere.slice(i) : ere.slice(i, close + 2);
      if (item !== "[:space:]") refuse(item);
      i = close + 1;
    }
  }
  return refuse("a bracket never closed");
}
