import { fromFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";

/**
 * The containment sweep's scanner (cli#574): which modules under `src/` mutate
 * the filesystem, which function each mutating call sits in, and which guard
 * calls stand in front of it. Its own module so `containment_sweep_test.ts` holds the
 * sweep only (cli#767); `containment_sweep_scan_test.ts` tests this one.
 */

const SRC = fromFileUrl(new URL("../../src", import.meta.url));

/** Deno APIs that create, move, delete or re-permission something on disk. */
const MUTATOR_NAMES =
  "writeTextFile writeFile mkdir remove rename chmod create truncate symlink link".split(" ");

/** A call to one of them, as text: how the population of mutating modules is found. */
export const MUTATOR_CALLS = new RegExp(`Deno\\.(${MUTATOR_NAMES.join("|")})\\(`, "g");

/** The generated bundle is 27k lines of template literals, not code that runs. */
const NOT_CODE = /src\/templates_bundle\.ts$/;

/** The containment checks, called by name: the only calls that may guard a sink. */
const GUARDS = ["assertInsideProject", "assertRemovableInProject"];

/**
 * The guards that may stand in front of a sink. A removal or a rename acts on
 * the entry itself, so the entry check `assertRemovableInProject` covers it as
 * well as `assertInsideProject` (cli#751); a write lands through the path, so
 * only `assertInsideProject` does.
 */
function guardsFor(api: string): string[] {
  return api === "remove" || api === "rename" ? GUARDS : ["assertInsideProject"];
}

/**
 * A mutating call at offset `at`; the function that owns it, which starts at
 * `from`; and the guard calls that stand in front of it.
 */
export type Sink = { api: string; at: number; owner: string; from: number; guards: string[] };

type Span = { start: number; end: number };
type Owner = Span & { name: string };
type Call = { name: string; at: number };
type Walked = { owners: Owner[]; fns: Span[]; calls: Call[]; guards: Call[]; comments: Span[] };

const holds = (s: Span, at: number) => s.start <= at && at < s.end;

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
 * An owner is a declaration with a name: a function declaration, a method (of a
 * class or an object literal), a class field or a variable holding a function.
 * A callback, or an arrow held by an object-literal property, is part of the
 * function around it, which is where the exclusion list names such sinks.
 */
export function parseSinks(src: string): { sinks: Sink[]; comments: Span[] } {
  const walked = walkAst(src);
  const sinks = walked.calls.map(({ name: api, at }) => {
    const { name, start } = innermost(walked.owners, at);
    return { api, at, owner: name, from: start, guards: guardsBefore(walked, start, at) };
  });
  return { sinks: sinks.sort((a, b) => a.at - b.at), comments: walked.comments };
}

/**
 * The guard calls that run before the sink at `at`, in the owner starting at
 * `from`: called between the two, and not inside a function the sink is outside
 * of. A guard in a nested function runs when that function is called, if ever.
 * Calls, not text: a comment or an import naming a guard guards nothing.
 */
function guardsBefore({ fns, guards }: Walked, from: number, at: number): string[] {
  const inFront = (g: Call) =>
    from <= g.at && g.at < at && fns.every((f) => !holds(f, g.at) || holds(f, at));
  return guards.filter(inFront).map((g) => g.name);
}

/** The owners, function spans, mutating calls, guard calls and comments of `src`. */
function walkAst(src: string): Walked {
  const walked: Walked = { owners: [], fns: [], calls: [], guards: [], comments: [] };
  const create = (ctx: Deno.lint.RuleContext) => {
    for (const { range } of ctx.sourceCode.getAllComments()) {
      walked.comments.push({ start: range[0], end: range[1] });
    }
    return visitor(walked);
  };
  // `runPlugin` exists only under `deno test`, the only caller.
  Deno.lint.runPlugin({ name: "containment-sweep", rules: { scan: { create } } }, "scan.ts", src);
  return walked;
}

/** The AST visitor that fills `walked`. */
const visitor = (walked: Walked): Deno.lint.LintVisitor => ({
  ...ownerVisitor(walked),
  ...callVisitor(walked),
});

/** Which nodes are owners: declarations with a name (see `parseSinks`). */
function ownerVisitor({ owners }: Walked): Deno.lint.LintVisitor {
  const own = (name: string | null, [start, end]: Deno.lint.Range) => {
    if (name !== null) owners.push({ name, start, end });
  };
  return {
    FunctionDeclaration: (n) => own(n.id?.name ?? null, n.range),
    MethodDefinition: (n) => own(nameOf(n.key), n.range),
    Property: (n) => {
      if (n.method) own(nameOf(n.key), n.range);
    },
    PropertyDefinition: (n) => {
      if (isFunction(n.value)) own(nameOf(n.key), n.range);
    },
    VariableDeclarator: (n) => {
      if (n.id.type === "Identifier" && isFunction(n.init)) own(n.id.name, n.range);
    },
  };
}

/** Every function's span, every mutating call and every guard call. */
function callVisitor({ fns, calls, guards }: Walked): Deno.lint.LintVisitor {
  return {
    "FunctionDeclaration, FunctionExpression, ArrowFunctionExpression": ({ range }) => {
      fns.push({ start: range[0], end: range[1] });
    },
    CallExpression: ({ callee, range }) => {
      const api = mutatorOf(callee);
      if (api !== null) calls.push({ name: api, at: range[0] });
      if (callee.type === "Identifier" && GUARDS.includes(callee.name)) {
        guards.push({ name: callee.name, at: range[0] });
      }
    },
  };
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
function innermost(owners: Owner[], at: number): Owner {
  let best: Owner = { name: "<module>", start: 0, end: Infinity };
  for (const o of owners) {
    if (holds(o, at) && o.start >= best.start) best = o;
  }
  return best;
}

/**
 * The owners with a mutating call no guard stands in front of: neither
 * `assertInsideProject`, nor for a removal or a rename, which act on the entry,
 * `assertRemovableInProject` (cli#751), is called before it in its owner's own
 * code. That answers the only question asked — "did anybody put a guard in
 * front of this sink" — failing toward a false ALARM rather than a false clean.
 * A FLOOR, not a proof: whether the guard checks the right path is
 * `sink_containment_test.ts`'s job.
 */
export function unguardedSinks(src: string): string[] {
  const out = new Set<string>();
  for (const { api, owner, guards } of parseSinks(src).sinks) {
    if (!guards.some((g) => guardsFor(api).includes(g))) out.add(owner);
  }
  return [...out];
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
