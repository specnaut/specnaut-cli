import { CHECKOUT_SCOPE } from "../domain/checkout_scope.ts";
import { RECORDED_SOURCES, recordOf } from "../domain/session_record.ts";
import { recordText, type SessionStart } from "../domain/session_record_json.ts";
import type {
  CheckoutTreeWalker,
  GitObjectReader,
  HeadReflogReader,
  RecordWrite,
  SessionRecordWriter,
} from "./script_trust_ports.ts";

/**
 * Records the checkout a session started on, from its `SessionStart` hook: HEAD's full sha, where
 * HEAD's reflog stands, and the walk of every root of `CHECKOUT_SCOPE`, by the same walker the
 * checkout check reads the folder with, so the scope has one home and both sides read it alike.
 * Only a source in `RECORDED_SOURCES` takes it; any other leaves the session's record as it was. A
 * session that already has one keeps it: its first record is never replaced.
 */

export type RecordCheckoutDeps = {
  readonly git: Pick<GitObjectReader, "commitOf"> & HeadReflogReader;
  readonly checkout: CheckoutTreeWalker;
  readonly records: SessionRecordWriter;
};

export type RecordOutcome =
  | { readonly kind: "kept"; readonly source: string }
  | RecordWrite
  | { readonly kind: "refused"; readonly why: string };

export async function recordCheckout(
  deps: RecordCheckoutDeps,
  start: SessionStart,
): Promise<RecordOutcome> {
  if (!RECORDED_SOURCES.has(start.source)) return { kind: "kept", source: start.source };
  const head = await deps.git.commitOf("HEAD");
  if (head === null) return { kind: "refused", why: "HEAD names no commit yet" };
  const reflog = await deps.git.headReflog();
  if (reflog.length === 0) return { kind: "refused", why: "HEAD's reflog cannot be read" };
  const mark = { entries: reflog.length, newest: reflog[0] };
  const tree = await Promise.all(CHECKOUT_SCOPE.map((root) => deps.checkout.walk(root)));
  const text = recordText(await recordOf(head, mark, tree));
  return await deps.records.write(start.sessionId, text);
}
