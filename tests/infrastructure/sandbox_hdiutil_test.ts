import { assertEquals } from "@std/assert";
import { attachedDisk } from "../../src/infrastructure/sandbox_hdiutil.ts";
import { attachAnswer } from "./sandbox_scratch_volume_fixture.ts";

/** The disk an attach made, read from its `-plist` answer: the whole disk, never a slice. */

const entry = (dev: string) => `<dict><key>dev-entry</key>\n\t<string>${dev}</string></dict>`;

Deno.test("attachedDisk: the image's own whole disk, its first listed", () => {
  assertEquals(attachedDisk(attachAnswer("/dev/disk12")), "/dev/disk12");
});

Deno.test("attachedDisk: a slice or anything not a whole disk's node is passed over", () => {
  const answer = ["/dev/disk4s1", "/dev/disk4 ", "/dev/rdisk4", "disk4", "/dev/disk4"].map(entry);
  assertEquals(attachedDisk(answer.join("\n")), "/dev/disk4");
});

Deno.test("attachedDisk: an answer naming no whole disk names none", () => {
  assertEquals(attachedDisk(entry("/dev/disk4s1")), null);
  assertEquals(attachedDisk(""), null);
});
