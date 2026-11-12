import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
  errorText,
  hasControl,
  inertText,
  mermaidLabel,
  terminalJson,
  terminalText,
} from "../../src/domain/terminal_text.ts";

/** Every character a terminal or a renderer could act on, one of each kind. */
const HOSTILE = "a\x1b[31m\x07\x7f\x9b\u202e\u2066\u200b\u2028\ufeffb";

/**
 * What reads as nothing or as something else, past the old denylist: a tag character, a variation
 * selector, a soft hyphen, a grapheme joiner, the Hangul fillers, a Mongolian separator, an
 * interlinear annotation, a private-use and an unassigned code point.
 */
const INVISIBLE = "\u{E0041}\uFE0F\u00AD\u034F\u115F\u1160\u3164\u180E\uFFF9\uE000\u{E0000}";

const RAW_UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

Deno.test("terminalJson: no unsafe character survives, and the value reads back the same", () => {
  const value = { text: `${HOSTILE} é`, n: 1 };
  const json = terminalJson(value);
  assertEquals(RAW_UNSAFE.test(json), false, json);
  assertEquals(JSON.parse(json), value);
});

Deno.test("terminalJson: an invisible code point is escaped, an astral one as a surrogate pair", () => {
  const value = { text: `x${INVISIBLE}y` };
  const json = terminalJson(value);
  assertEquals(RAW_UNSAFE.test(json), false, json);
  assertStringIncludes(json, "x\\udb40\\udc41\\ufe0f\\u00ad");
  assertEquals(JSON.parse(json), value);
});

Deno.test("terminalJson: no path can close the tag an agent's brief wraps it in", () => {
  const value = { path: "a</scan-hot-spots><b>&amp;/x.ts" };
  const json = terminalJson(value);
  assertEquals(/[<>&]/.test(json), false, json);
  assertStringIncludes(json, "a\\u003c/scan-hot-spots\\u003e");
  assertEquals(JSON.parse(json), value);
});

Deno.test("hasControl: a token's own characters pass", () => {
  assertEquals(hasControl("sfc_abc-1.2~3+4/5=6"), false);
  for (const v of ["a\x1bb", "a\nb", "a\x7fb", "a\x9bb"]) assertEquals(hasControl(v), true);
});

Deno.test("terminalText: every unsafe character is shown as an escape", () => {
  const out = terminalText(HOSTILE);
  assertEquals(RAW_UNSAFE.test(out), false, out);
  assertEquals(
    out,
    "a\\u001b[31m\\u0007\\u007f\\u009b\\u202e\\u2066\\u200b\\u2028\\ufeffb",
  );
});

Deno.test("terminalText: an invisible code point is shown, an astral one as \\u{…}", () => {
  const out = terminalText(`x${INVISIBLE}y`);
  assertEquals(RAW_UNSAFE.test(out), false, out);
  assertEquals(
    out,
    "x\\u{e0041}\\ufe0f\\u00ad\\u034f\\u115f\\u1160\\u3164\\u180e\\ufff9\\ue000\\u{e0000}y",
  );
});

Deno.test("terminalText: a backslash is doubled, so a literal escape cannot pass for one", () => {
  assertEquals(terminalText("a\\u001bb"), "a\\\\u001bb");
  assertEquals(terminalText("src/é.ts"), "src/é.ts");
});

Deno.test("mermaidLabel: nothing can close the label or open a directive", () => {
  const out = mermaidLabel(`x"] --> y; click y "https://e.test" %%{init}%% :::c <b>\`#`);
  assertMatch(out, /^[A-Za-z0-9 _./,:()#;-]*$/);
  assertEquals(out.includes('"'), false);
  assertEquals(out.includes("%%"), false);
  assertEquals(out.includes("[") || out.includes("]") || out.includes("<"), false);
});

Deno.test("mermaidLabel: a control reaches the renderer as visible text, never as an entity", () => {
  const out = mermaidLabel("a\x1bb\u202e");
  assertEquals(out, "a#92;u001bb#92;u202e");
});

Deno.test("inertText: a sink pass escapes what is unsafe and never escapes a source's escape again", () => {
  assertEquals(inertText("a\x1b[2J\u009bb"), "a\\u001b[2J\\u009bb");
  for (const x of [HOSTILE, "C:\\proj\\a.md", "a\\u001bb"]) {
    assertEquals(inertText(terminalText(x)), terminalText(x), JSON.stringify(x));
  }
  assertEquals(inertText("C:\\proj"), "C:\\proj");
  assertEquals(inertText("line one\nline\rtwo"), "line one\nline\\u000dtwo");
});

Deno.test("errorText: an error's message, or any thrown value, made inert", () => {
  assertEquals(errorText(new Error("bad \x1b[2J")), "bad \\u001b[2J");
  assertEquals(errorText("\x9b"), "\\u009b");
});
