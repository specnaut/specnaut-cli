import { assertEquals } from "@std/assert";
import {
  type ApprovalClass,
  approvalVerdict,
  type ApprovedDigests,
  type ClassNow,
  scriptsApprovable,
} from "../../src/domain/approval_verdict.ts";
import { REASON } from "../../src/domain/trust_reason.ts";

/**
 * The verdict on a user's yes: per approved class, whether the digest judged now is the one the yes
 * named, and whether every class is trusted or held by its yes.
 */

const A = "a".repeat(64);
const B = "b".repeat(64);

const now = (trusted: boolean, digest = A, approvable = true): ClassNow => ({
  trusted,
  digest,
  approvable,
});

type Row = {
  name: string;
  approved: ApprovedDigests;
  state: Record<ApprovalClass, ClassNow>;
  lines: string[];
  holds: boolean;
};

const line = (l: { class: string; holds: boolean; digest: string }) =>
  `${l.class} ${l.holds ? "holds" : "moved"} ${l.digest.slice(0, 1)}`;

// deno-fmt-ignore
const ROWS: Row[] = [
  { name: "both trusted, no yes", approved: {}, state: { scripts: now(true), instructions: now(true) }, lines: [], holds: true },
  { name: "scripts untrusted, no yes", approved: {}, state: { scripts: now(false), instructions: now(true) }, lines: [], holds: false },
  { name: "instructions untrusted, no yes", approved: {}, state: { scripts: now(true), instructions: now(false) }, lines: [], holds: false },
  { name: "scripts matched", approved: { scripts: A }, state: { scripts: now(false), instructions: now(true) }, lines: ["scripts holds a"], holds: true },
  { name: "scripts mismatched", approved: { scripts: B }, state: { scripts: now(false), instructions: now(true) }, lines: ["scripts moved a"], holds: false },
  { name: "scripts trusted, yes mismatched", approved: { scripts: B }, state: { scripts: now(true), instructions: now(true) }, lines: ["scripts moved a"], holds: true },
  { name: "scripts matched but a reason no yes covers", approved: { scripts: A }, state: { scripts: now(false, A, false), instructions: now(true) }, lines: ["scripts moved a"], holds: false },
  { name: "instructions matched", approved: { instructions: A }, state: { scripts: now(true), instructions: now(false) }, lines: ["instructions holds a"], holds: true },
  { name: "instructions mismatched", approved: { instructions: B }, state: { scripts: now(true), instructions: now(false) }, lines: ["instructions moved a"], holds: false },
  { name: "instructions held, scripts untrusted and not approved", approved: { instructions: A }, state: { scripts: now(false), instructions: now(false) }, lines: ["instructions holds a"], holds: false },
  { name: "scripts held, instructions untrusted and not approved", approved: { scripts: A }, state: { scripts: now(false), instructions: now(false) }, lines: ["scripts holds a"], holds: false },
  { name: "both held", approved: { scripts: A, instructions: B }, state: { scripts: now(false), instructions: now(false, B) }, lines: ["scripts holds a", "instructions holds b"], holds: true },
  { name: "one of two moved", approved: { scripts: A, instructions: A }, state: { scripts: now(false), instructions: now(false, B) }, lines: ["scripts holds a", "instructions moved b"], holds: false },
];

for (const row of ROWS) {
  Deno.test(`approval verdict: ${row.name}`, () => {
    const v = approvalVerdict(row.approved, row.state);
    assertEquals(v.lines.map(line), row.lines);
    assertEquals(v.holds, row.holds);
  });
}

Deno.test("a yes covers the scripts folder only: a reason outside it is never approvable", () => {
  assertEquals(scriptsApprovable([]), true);
  assertEquals(
    scriptsApprovable([{ path: ".specnaut/scripts/bash/x.sh", reason: "differs from base" }]),
    true,
  );
  for (const path of ["refs/heads/main", ".specnaut/installed.lock", ".specnaut/scripts"]) {
    assertEquals(scriptsApprovable([{ path, reason: REASON.differs }]), false, path);
  }
  assertEquals(
    scriptsApprovable([{ path: ".specnaut/scripts-x/a.sh", reason: REASON.differs }]),
    false,
  );
});

Deno.test("a yes binds only the bytes the digest covers: a link, a non-file or a blocked walk never", () => {
  const at = (reason: string) => [{ path: ".specnaut/scripts/bash/x.sh", reason }];
  for (
    const reason of [
      REASON.differs,
      REASON.notOnBase,
      REASON.firstInstall,
      REASON.missing,
      REASON.caseDiffers,
      REASON.lineEndings,
      REASON.behind,
      REASON.baseNotRegular,
    ]
  ) assertEquals(scriptsApprovable(at(reason)), true, reason);
  for (
    const reason of [
      REASON.link,
      REASON.notRegular,
      REASON.hardLinked,
      REASON.submodule,
      "unreadable: permission denied",
      "a link in the path: .specnaut/scripts/bash",
    ]
  ) assertEquals(scriptsApprovable(at(reason)), false, reason);
});
