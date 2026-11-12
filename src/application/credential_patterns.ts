// The credential patterns the clients check written text with, as this build carries
// them: `_secret_patterns.txt`, from the template bundle, compiled once. The domain
// compiles and matches; looking the file up in the bundle belongs out here.

import { compilePatterns, type CredentialPatterns } from "../domain/cloud/credential_check.ts";
import { CORE_BUNDLE } from "../templates_bundle.ts";

/** Where the pattern file sits in the bundle: beside the bash scan that reads it too. */
const PATTERNS_SUFFIX = "scripts/bash/_secret_patterns.txt";

let compiled: CredentialPatterns | undefined;

/** The bundled patterns, compiled on first use; a build without them throws. */
export function bundledCredentialPatterns(): CredentialPatterns {
  if (compiled) return compiled;
  const file = CORE_BUNDLE.find((e) => e.suffix === PATTERNS_SUFFIX);
  if (!file) throw new Error("this build carries no credential patterns");
  return (compiled = compilePatterns(file.content));
}
