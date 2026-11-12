import { CHECKOUT_SCOPE } from "../domain/checkout_scope.ts";
import { RECORDED_SOURCES, recordOf } from "../domain/session_record.ts";
import { recordText, type SessionStart } from "../domain/session_record_json.ts";
import type {
  CheckoutTreeWalker,
  GitObjectReader,
  SessionRecordWriter,
} from "./script_trust_ports.ts";

/**
 * Records the checkout a session started on, from its `SessionStart` hook: HEAD's full sha and the
 * walk of every root of `CHECKOUT_SCOPE`, by the same walker the checkout check reads the folder
 * with, so the scope has one home and both sides read it alike. Only a source in
 * `RECORDED_SOURCES` takes it; any other leaves the session's record as it was.
 */

export type RecordCheckoutDeps = {
  readonly git: Pick<GitObjectReader, "commitOf">;
  readonly checkout: CheckoutTreeWalker;
  readonly records: SessionRecordWriter;
};

export type RecordOutcome =
  | { readonly kind: "kept"; readonly source: string }
  | { readonly kind: "taken"; readonly path: string }
  | { readonly kind: "refused"; readonly why: string };

export async function recordCheckout(
  deps: RecordCheckoutDeps,
  start: SessionStart,
): Promise<RecordOutcome> {
  if (!RECORDED_SOURCES.has(start.source)) return { kind: "kept", source: start.source };
  const head = await deps.git.commitOf("HEAD");
  if (head === null) return { kind: "refused", why: "HEAD names no commit yet" };
  const tree = await Promise.all(CHECKOUT_SCOPE.map((root) => deps.checkout.walk(root)));
  const text = recordText(await recordOf(head, tree));
  return { kind: "taken", path: await deps.records.write(start.sessionId, text) };
}
