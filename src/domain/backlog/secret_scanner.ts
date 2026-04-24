export type SecretKind = "github_pat" | "stripe_secret" | "aws_access_key";

export type SecretHit = {
  readonly kind: SecretKind;
  readonly line: number;
  readonly preview: string;
};

const PATTERNS: ReadonlyArray<{ kind: SecretKind; re: RegExp }> = [
  { kind: "github_pat", re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { kind: "stripe_secret", re: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
  { kind: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
];

export function scanForSecrets(body: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    for (const { kind, re } of PATTERNS) {
      const m = re.exec(line);
      if (m) {
        hits.push({
          kind,
          line: i + 1,
          preview: m[0].slice(0, 12) + "…",
        });
      }
    }
  });
  return hits;
}
