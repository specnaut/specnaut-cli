import { CHECKOUT_SCOPE } from "../domain/checkout_scope.ts";
import { reflogMark } from "../domain/head_reflog.ts";
import { RECORDED_SOURCES, recordOf, TAKING_SOURCE } from "../domain/session_record.ts";
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
 * Only `TAKING_SOURCE` takes it, the other `RECORDED_SOURCES` find it, and any other source leaves
 * it as it was. A session that already has one keeps it: its first record is never replaced.
 */

/** Without HEAD's reflog a branch checked out during the session could not be seen. */
export const NO_REFLOG = "HEAD has no reflog git keeps, or one holding a line that is not an " +
  "entry: a branch checked out during the session could not be seen";

/** A resumed or forked session whose start took no record: none taken now would be its first. */
export const NO_FIRST_RECORD = "this session has no first record: start a new session";

export type RecordCheckoutDeps = {
  readonly git: Pick<GitObjectReader, "commitOf">;
  readonly reflog: HeadReflogReader;
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
  if (start.source !== TAKING_SOURCE) {
    return await deps.records.find(start.sessionId) ?? { kind: "refused", why: NO_FIRST_RECORD };
  }
  const head = await deps.git.commitOf("HEAD");
  if (head === null) return { kind: "refused", why: "HEAD names no commit yet" };
  const reflog = await deps.reflog.headReflog();
  const mark = reflog === null ? null : await reflogMark(reflog);
  if (mark === null) return { kind: "refused", why: NO_REFLOG };
  const tree = await Promise.all(CHECKOUT_SCOPE.map((root) => deps.checkout.walk(root)));
  const text = recordText(await recordOf(head, mark, tree));
  return await deps.records.write(start.sessionId, text);
}
