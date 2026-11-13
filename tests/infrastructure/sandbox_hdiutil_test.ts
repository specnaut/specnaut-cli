import { assertEquals } from "@std/assert";
import { attachedDisk } from "../../src/infrastructure/sandbox_hdiutil.ts";
import { attachAnswer, entity } from "./sandbox_scratch_volume_fixture.ts";

/**
 * The disk an attach made, read from its `-plist` answer: the image's own whole disk, the one
 * carrying its partition scheme, wherever it is listed; never a slice, never the APFS container.
 */

Deno.test("attachedDisk: the image's own whole disk", () => {
  assertEquals(attachedDisk(attachAnswer("/dev/disk12")), "/dev/disk12");
});

Deno.test("attachedDisk: the APFS container listed first is passed over for the image's disk", () => {
  assertEquals(attachedDisk(attachAnswer("/dev/disk12", true)), "/dev/disk12");
});

Deno.test("attachedDisk: a slice or anything not a whole disk's node is passed over", () => {
  const scheme = "GUID_partition_scheme";
  const nodes = ["/dev/disk4s1", "/dev/disk4 ", "/dev/rdisk4", "disk4", "/dev/disk4"];
  assertEquals(attachedDisk(nodes.map((dev) => entity(dev, scheme)).join("")), "/dev/disk4");
});

Deno.test("attachedDisk: an answer naming no partitioned whole disk names none", () => {
  assertEquals(attachedDisk(entity("/dev/disk4s1", "GUID_partition_scheme")), null);
  assertEquals(attachedDisk(entity("/dev/disk4", "Apple_APFS")), null);
  assertEquals(attachedDisk(""), null);
});
