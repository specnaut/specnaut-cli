import { assertEquals } from "@std/assert";
import { buildProjectChoices } from "../../src/cli/handlers/cloud_handler.ts";
import type { CloudProject } from "../../src/domain/cloud/cloud_client.ts";

const P = (key: string, name: string, role = ""): CloudProject => ({ key, name, role });

Deno.test("buildProjectChoices lists every project then a create row", () => {
  const items = buildProjectChoices([P("TASK", "My Project", "owner"), P("CLOUD", "Cloud")]);
  assertEquals(items.length, 3);
  assertEquals(items[0].key, { kind: "pick", key: "TASK" });
  assertEquals(items[1].key, { kind: "pick", key: "CLOUD" });
  assertEquals(items[2].key, { kind: "create" });
});

Deno.test("buildProjectChoices always ends with a create row, even with no projects", () => {
  const items = buildProjectChoices([]);
  assertEquals(items.length, 1);
  assertEquals(items[0].key, { kind: "create" });
});

Deno.test("buildProjectChoices labels carry the key, name and role", () => {
  const [item] = buildProjectChoices([P("TASK", "My Project", "owner")]);
  // Labels are ANSI-wrapped, but the raw text is still present as substrings.
  assertEquals(item.label.includes("TASK"), true);
  assertEquals(item.label.includes("My Project"), true);
  assertEquals(item.label.includes("owner"), true);
});
