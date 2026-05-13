import { assertEquals } from "@std/assert";
import { detectVersionScheme, type FsSnapshot } from "../../src/domain/project_detection.ts";

function fakeFs(files: Record<string, string>): FsSnapshot {
  return {
    exists(rel) {
      return Object.prototype.hasOwnProperty.call(files, rel);
    },
    readText(rel) {
      return Object.prototype.hasOwnProperty.call(files, rel) ? files[rel] : null;
    },
  };
}

Deno.test("detectVersionScheme defaults to date when no library markers exist", () => {
  const r = detectVersionScheme(fakeFs({}));
  assertEquals(r.suggestedScheme, "date");
  assertEquals(r.evidence, []);
});

Deno.test("detectVersionScheme suggests semver when package.json has exports", () => {
  const r = detectVersionScheme(fakeFs({
    "package.json": JSON.stringify({
      name: "my-lib",
      exports: { ".": "./index.js" },
    }),
  }));
  assertEquals(r.suggestedScheme, "semver");
  assertEquals(r.evidence.length, 1);
});

Deno.test("detectVersionScheme does NOT suggest semver for a private app package.json", () => {
  // Private app projects (Vite, Next, Express) typically have neither
  // `exports`, `publishConfig`, nor `private: false`.
  const r = detectVersionScheme(fakeFs({
    "package.json": JSON.stringify({
      name: "my-app",
      private: true,
      scripts: { dev: "vite" },
    }),
  }));
  assertEquals(r.suggestedScheme, "date");
});

Deno.test("detectVersionScheme suggests semver when pyproject.toml has [project]", () => {
  const r = detectVersionScheme(fakeFs({
    "pyproject.toml": '[project]\nname = "my-pkg"\n',
  }));
  assertEquals(r.suggestedScheme, "semver");
});

Deno.test("detectVersionScheme suggests semver when pyproject.toml has [tool.poetry]", () => {
  const r = detectVersionScheme(fakeFs({
    "pyproject.toml": '[tool.poetry]\nname = "my-pkg"\n',
  }));
  assertEquals(r.suggestedScheme, "semver");
});

Deno.test("detectVersionScheme suggests semver when Cargo.toml has [lib]", () => {
  const r = detectVersionScheme(fakeFs({
    "Cargo.toml": '[package]\nname = "foo"\n\n[lib]\nname = "foo"\n',
  }));
  assertEquals(r.suggestedScheme, "semver");
});

Deno.test("detectVersionScheme stays at date when Cargo.toml is bin-only", () => {
  const r = detectVersionScheme(fakeFs({
    "Cargo.toml": '[package]\nname = "foo"\n\n[[bin]]\nname = "foo"\n',
  }));
  assertEquals(r.suggestedScheme, "date");
});

Deno.test("detectVersionScheme suggests semver when composer.json type=library", () => {
  const r = detectVersionScheme(fakeFs({
    "composer.json": JSON.stringify({ name: "foo/bar", type: "library" }),
  }));
  assertEquals(r.suggestedScheme, "semver");
});

Deno.test("detectVersionScheme ignores malformed JSON gracefully", () => {
  const r = detectVersionScheme(fakeFs({
    "package.json": "{ this is not valid JSON",
  }));
  // No library marker extractable → date default, no evidence added.
  assertEquals(r.suggestedScheme, "date");
});

Deno.test("detectVersionScheme collects multiple evidence lines when several markers exist", () => {
  const r = detectVersionScheme(fakeFs({
    "package.json": JSON.stringify({ exports: { ".": "./index.js" } }),
    "pyproject.toml": '[project]\nname = "foo"\n',
  }));
  assertEquals(r.suggestedScheme, "semver");
  assertEquals(r.evidence.length, 2);
});
