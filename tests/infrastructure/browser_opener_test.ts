import { assertEquals } from "@std/assert";
import { browserCommand } from "../../src/infrastructure/browser_opener.ts";

const URL_ = "https://cloud.example.test/device?code=AB";

Deno.test("browserCommand: each platform's launcher, and the URL as one argument", () => {
  assertEquals(browserCommand("darwin", URL_), ["open", [URL_]]);
  assertEquals(browserCommand("linux", URL_), ["xdg-open", [URL_]]);
  assertEquals(browserCommand("windows", URL_), [
    "rundll32",
    ["url.dll,FileProtocolHandler", URL_],
  ]);
});

Deno.test("browserCommand: the URL handed on is the normalized one", () => {
  for (const os of ["darwin", "linux", "windows"]) {
    const args = browserCommand(os, 'https://x.example.test/a b?q="c"')?.[1] ?? [];
    assertEquals(args.at(-1), "https://x.example.test/a%20b?q=%22c%22", os);
    assertEquals(
      browserCommand(os, "https://x.example.test/`a`")?.[1].at(-1),
      "https://x.example.test/%60a%60",
      os,
    );
  }
});

Deno.test("browserCommand: only a plain URL opens", () => {
  for (
    const url of [
      "https://x.example.test/$(a)",
      "https://x%22y.example.test/",
      "https://u:p@x.example.test/",
      "https://x.example.test/a;b|c",
      "https://x.example.test/a'b",
    ]
  ) {
    assertEquals(browserCommand("linux", url), null, url);
    assertEquals(browserCommand("windows", url), null, url);
  }
  const fine = "https://x.example.test:8443/a-b_c.d/~e?code=AB-12&x=1%202&y=a+b,c#f";
  assertEquals(browserCommand("windows", fine)?.[1].at(-1), fine);
});

Deno.test("browserCommand: only a well-formed http(s) URL opens", () => {
  for (const url of ["file:///etc/passwd", "custom://x", "javascript:alert(1)", "not a url", ""]) {
    assertEquals(browserCommand("linux", url), null, url);
  }
  assertEquals(browserCommand("linux", "http://x.example.test/")?.[0], "xdg-open");
});
