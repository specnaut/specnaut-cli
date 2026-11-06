import { FULL_BODY } from "./groom_sandbox.ts";

/**
 * The tracker answers the remote `groom-verify.sh` tests read: a GraphQL issue
 * as `gh api graphql` returns it, and the stand-in `gh` and `glab` that serve
 * them from $FIXTURES (groom_verify_remote_test.ts).
 */

/** One `issue(number:)` GraphQL answer, the shape `gh api graphql` returns. */
export function ghIssue(o: {
  body?: string;
  state?: string;
  stateReason?: string | null;
  labels?: string[];
  comments?: string[];
  items?: Array<{ number: number; owner?: string; fields: Record<string, string> }>;
}) {
  return {
    data: {
      repository: {
        issue: {
          body: o.body ?? FULL_BODY,
          state: o.state ?? "OPEN",
          stateReason: o.stateReason ?? null,
          labels: { nodes: (o.labels ?? []).map((name) => ({ name })) },
          comments: { nodes: (o.comments ?? []).map((body) => ({ body })) },
          projectItems: {
            nodes: (o.items ?? []).map((it) => ({
              project: { number: it.number, owner: { login: it.owner ?? "acme" } },
              fieldValues: {
                nodes: [
                  {},
                  ...Object.entries(it.fields).map(([field, name]) => ({
                    name,
                    field: { name: field },
                  })),
                ],
              },
            })),
          },
        },
      },
    },
  };
}

/** `gh api graphql … -F num=<n>` answers with $FIXTURES/gh-<n>.json; a missing file fails like gh. */
export const GH_STUB = `
num=""
for a in "$@"; do case "$a" in num=*) num="\${a#num=}" ;; esac; done
[ "$1 $2" = "api graphql" ] && [ -f "$FIXTURES/gh-$num.json" ] || { echo "gh: stub has no answer for $*" >&2; exit 1; }
cat "$FIXTURES/gh-$num.json"
`;

/** `glab issue view <n>` → $FIXTURES/gl-<n>.json; `glab api …/issues/<n>/notes…` → gl-<n>-notes.json. */
export const GL_STUB = `
case "$1 $2" in
  "issue view") f="$FIXTURES/gl-$3.json" ;;
  api*) n="\${2#*issues/}"; n="\${n%%/*}"; f="$FIXTURES/gl-$n-notes.json"
        case "$2" in projects/acme%2Fwidget/*) ;; *) echo "glab: unencoded project in $2" >&2; exit 1 ;; esac ;;
  *) f="" ;;
esac
[ -n "$f" ] && [ -f "$f" ] || { echo "glab: stub has no answer for $*" >&2; exit 1; }
cat "$f"
`;
