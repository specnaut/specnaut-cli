// The escaping cases of the Go goldens (cli#776), apart so golden.ts stays within its size:
// destinations and lock keys with control and format characters, and terminalText's own inputs.
import { inertText, terminalText } from "../../src/domain/terminal_text.ts";

/** Destinations with control and format characters: refused, or shown escaped. */
export const ESCAPING_DESTINATIONS = [
  "a\0b",
  "a\x1b[2Jb.md",
  "a\x9bb",
  "a\x7fb",
  "/\u202e.md",
  "../\u202e",
  "\u202e. ",
];

const head = "version: 2\nharness: claude\ntemplates_version: 0.0.1\nentries:\n";
const fields =
  "    sha256: x\n    installed_at: '2026-01-01T00:00:00.000Z'\n    templates_version: 0.0.1\n";

/** Lock keys with a control and a format character. */
export const ESCAPING_LOCKS: Record<string, string> = {
  "entry-control-key": head + '  "a\\u001b]0;x\\u0007b.md":\n' + fields,
  "entry-format-key": head + '  "a\\u202eb.md": 7\n',
  "harness-control": 'version: 2\nharness: "\\e[2J"\ntemplates_version: 0.0.1\n',
  "version-control": 'version: "\\x9b2J"\nharness: claude\n',
};

/** terminalText's inputs: each Unicode property it escapes, and what it leaves. */
const texts = [
  "plain/a.md",
  "a\\b",
  "\x00\x1b\x7f\x85\x9f",
  "\u00ad\u200b\u200d\u202e\u2066\ufeff",
  "\u2028\u2029",
  "\ue000\u{f0000}",
  "\u0378",
  "\u034f\u115f\u3164\uffa0\u180e",
  "\ufe0f\u{e0100}\u{e0041}\u{e01f0}",
  "é中😀\ufffd",
  "a\\u001bb",
  "two\nlines\r\t",
];

export const TERMINAL_TEXT_CASES = texts.map((text) => ({
  text,
  shown: terminalText(text),
  inert: inertText(text),
}));
