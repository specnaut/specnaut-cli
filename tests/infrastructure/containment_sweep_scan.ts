import { fromFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";

/**
 * The containment sweep's scanner (cli#574): which modules under `src/` mutate
 * the filesystem, which function each mutating call sits in, and the exclusion
 * list's parser. Its own module so `containment_sweep_test.ts` holds the
 * assertions only (cli#767).
 */

const SRC = fromFileUrl(new URL("../../src", import.meta.url));

/** Deno APIs that create, move, delete or re-permission something on disk. */
const MUTATOR_NAMES = [
  "writeTextFile",
  "writeFile",
  "mkdir",
  "remove",
  "rename",
  "chmod",
  "create",
  "truncate",
  "symlink",
  "link",
];

/** A call to one of them, as text: how the population of mutating modules is found. */
export const MUTATOR_CALLS = new RegExp(`Deno\\.(${MUTATOR_NAMES.join("|")})\\(`, "g");

/** The generated bundle is 27k lines of template literals, not code that runs. */
const NOT_CODE = /src\/templates_bundle\.ts$/;

/**
 * The guard that may stand in front of a sink. A removal or a rename acts on the
 * entry itself, so the entry check `assertRemovableInProject` covers it as well
 * as `assertInsideProject` (cli#751); a write lands through the path, so only
 * `assertInsideProject` does.
 */
function guardFor(api: string): RegExp {
  return api === "remove" || api === "rename"
    ? /assertInsideProject|assertRemovableInProject/
    : /assertInsideProject/;
}

/** A mutating call at offset `at`, and the function that owns it, which starts at `from`. */
export type Sink = { api: string; at: number; owner: string; from: number };

type Span = { name: string; start: number; end: number };

const isFunction = (node: { type: string } | null) =>
  node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";

const nameOf = (key: Deno.lint.Node) =>
  key.type === "Identifier" || key.type === "PrivateIdentifier" ? key.name : null;

/**
 * Parses `src` with Deno's own TypeScript parser (the lint plugin AST) and
 * charges each mutating call to the innermost NAMED function around it (cli#766).
 *
 * A signature pattern cannot do this: it stopped at the first `)`, so a
 * multi-line signature with a function-typed parameter went unseen and its sink
 * was charged to the function before it, then excused under that one's name.
 * An owner is a declaration with a name — a function declaration, a class
 * method or field, a function bound to a variable. A callback or an
 * object-literal member is part of the function around it, which is where the
 * exclusion list names such sinks.
 */
export function parseSinks(src: string): { sinks: Sink[]; comments: Array<[number, number]> } {
  const { owners, calls, comments } = walkAst(src);
  const sinks = calls.map(({ api, at }) => {
    const { name, start } = innermost(owners, at);
    return { api, at, owner: name, from: start };
  });
  return { sinks: sinks.sort((a, b) => a.at - b.at), comments };
}

/** The named owners, the mutating calls and the comments of `src`. `runPlugin` exists only under `deno test`. */
function walkAst(src: string) {
  const owners: Span[] = [];
  const calls: Array<{ api: string; at: number }> = [];
  const comments: Array<[number, number]> = [];
  const own = (name: string | null, [start, end]: Deno.lint.Range) => {
    if (name !== null) owners.push({ name, start, end });
  };
  const create = (ctx: Deno.lint.RuleContext): Deno.lint.LintVisitor => {
    for (const c of ctx.sourceCode.getAllComments()) comments.push([c.range[0], c.range[1]]);
    return {
      FunctionDeclaration: (n) => own(n.id?.name ?? null, n.range),
      MethodDefinition: (n) => own(nameOf(n.key), n.range),
      PropertyDefinition: (n) => isFunction(n.value) && own(nameOf(n.key), n.range),
      VariableDeclarator: (n) =>
        n.id.type === "Identifier" && isFunction(n.init) && own(n.id.name, n.range),
      CallExpression: ({ callee, range }) => {
        const api = mutatorOf(callee);
        if (api !== null) calls.push({ api, at: range[0] });
      },
    };
  };
  Deno.lint.runPlugin({ name: "containment-sweep", rules: { scan: { create } } }, "scan.ts", src);
  return { owners, calls, comments };
}

/** The mutator a call reaches, written `Deno.<name>(…)`, or null. */
function mutatorOf(callee: Deno.lint.CallExpression["callee"]): string | null {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  const { object, property } = callee;
  if (object.type !== "Identifier" || object.name !== "Deno") return null;
  if (property.type !== "Identifier" || !MUTATOR_NAMES.includes(property.name)) return null;
  return property.name;
}

/** The owner whose span holds `at` and starts last; spans nest, so that is the innermost. */
function innermost(owners: Span[], at: number): Span {
  let best: Span = { name: "<module>", start: 0, end: Infinity };
  for (const o of owners) {
    if (o.start <= at && at < o.end && o.start >= best.start) best = o;
  }
  return best;
}

/**
 * The owners with a mutating call no guard stands in front of: neither
 * `assertInsideProject`, nor for a removal or a rename, which act on the entry,
 * `assertRemovableInProject` (cli#751), appears between the owner's start and
 * the call. That answers the only question asked — "did anybody put a guard in
 * front of this sink" — failing toward a false ALARM rather than a false clean.
 * A FLOOR, not a proof: whether the guard checks the right path is
 * `sink_containment_test.ts`'s job.
 */
export function unguardedSinks(src: string): string[] {
  const out = new Set<string>();
  for (const { api, at, owner, from } of parseSinks(src).sinks) {
    if (!guardFor(api).test(src.slice(from, at))) out.add(owner);
  }
  return [...out];
}

export type Exclusion = { path: string; reason: string };

/** An entry is either `<path>` or `<path>::<method>`; both name the same file. */
export function fileOf(entry: string): string {
  const i = entry.indexOf("::");
  return i === -1 ? entry : entry.slice(0, i);
}

export function readExclusions(text: string): Exclusion[] {
  const out: Exclusion[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const path = t.split(/\s+/)[0];
    const reason = t.slice(path.length).trim();
    out.push({ path, reason });
  }
  return out;
}

export async function mutatingModules(): Promise<string[]> {
  const found: string[] = [];
  for await (const e of walk(SRC, { exts: [".ts"], includeDirs: false, followSymlinks: false })) {
    const rel = "src" + e.path.slice(SRC.length).replaceAll("\\", "/");
    if (NOT_CODE.test(rel)) continue;
    if (new RegExp(MUTATOR_CALLS.source).test(await Deno.readTextFile(e.path))) found.push(rel);
  }
  return found.sort();
}
