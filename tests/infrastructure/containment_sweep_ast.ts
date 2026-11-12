/**
 * The containment sweep's AST walk (cli#766): one module parsed with Deno's own
 * TypeScript parser, through the lint plugin API, into the named functions, the
 * function spans, the mutating calls, the guard calls and the comments it holds.
 * Its own module so `containment_sweep_scan.ts` holds the judging only.
 */

/** Deno APIs that create, move, delete or re-permission something on disk. */
export const MUTATOR_NAMES =
  "writeTextFile writeFile mkdir remove rename chmod create truncate symlink link".split(" ");

/** The containment checks, called by name: the only calls that may guard a sink. */
export const GUARDS = ["assertInsideProject", "assertRemovableInProject"];

export type Span = { start: number; end: number };
export type Owner = Span & { name: string };
export type Call = { name: string; at: number };
export type Walked = {
  owners: Owner[];
  fns: Span[];
  calls: Call[];
  guards: Call[];
  comments: Span[];
};

export const holds = (s: Span, at: number) => s.start <= at && at < s.end;

const isFunction = (node: { type: string } | null) =>
  node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";

const nameOf = (key: Deno.lint.Node) =>
  key.type === "Identifier" || key.type === "PrivateIdentifier" ? key.name : null;

/** The owners, function spans, mutating calls, guard calls and comments of `src`. */
export function walkAst(src: string): Walked {
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
