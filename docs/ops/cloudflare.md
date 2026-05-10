# Cloudflare configuration — `specflow.makerlabs.dev`

Operational notes for the docs site's Cloudflare setup. Update this file whenever the zone
configuration changes.

## Zone

| Field    | Value                                                           |
| -------- | --------------------------------------------------------------- |
| Zone     | `makerlabs.dev`                                                 |
| Zone ID  | `f9cb36b13418b65c6dc5195b0cb12bfb`                              |
| Account  | MakerLabs (`bd857b121518642d0965231d074c3f0d`)                  |
| Plan     | Free                                                            |
| Hostname | `specflow.makerlabs.dev` (custom domain on top of GitHub Pages) |

## AI crawler allow-list (resolves #145)

The Cloudflare Bot Management → **AI Crawlers** panel governs per-bot identity-based access. By
default these crawlers are blocked by Bot Fight Mode, which broke automated LLM-style fetchers
reading `https://specflow.makerlabs.dev/llms.txt` (the file's whole purpose is LLM consumption per
[llmstxt.org](https://llmstxt.org)).

The following AI crawlers are explicitly **Allow**ed at the zone level:

- Anthropic — `Claude-SearchBot`, `Claude-User`, `ClaudeBot`
- OpenAI — `GPTBot`, `ChatGPT-User`, `OAI-SearchBot`
- Google — `Google-CloudVertexBot` (Googlebot itself is a search-engine crawler, separate row)
- Apple — `Applebot`, `Applebot-Extended`
- Common Crawl — `CCBot`
- Meta — `FacebookBot`, `Meta-ExternalAgent`, `Meta-ExternalFetcher`
- DuckDuckGo — `DuckAssistBot`
- Mistral — `MistralAI-User`
- Perplexity — `Perplexity-User`, `PerplexityBot`
- Cloudflare — `Cloudflare Crawler`
- Plus other AI Crawlers / AI Assistants / AI Search categories

In short: the panel was set so that every AI-category crawler is allowed. Search Engine Crawlers and
Archivers are also allowed. Only non-AI / non-archival bot traffic is challenged by default Bot
Fight Mode rules.

### Why this approach over a WAF Custom Rule

Two paths were considered (per the devops-sre advisory on #145):

1. **WAF Custom Rule** scoped to `(http.host eq "specflow.makerlabs.dev")` that skips bot
   challenges. Narrower (zone has other subdomains in theory), but requires expression maintenance
   and bot-product code knowledge.
2. **AI Crawlers panel allow-list** (chosen). Identity-based rather than expression-based.
   Cloudflare maintains the crawler list as new AI products ship — we don't need to track UA strings
   ourselves.

The trade-off: this allow-list applies to the whole `makerlabs.dev` zone, not just `specflow.*`.
Acceptable today because the zone serves docs only — there is no other public hostname that would
need bot protection against AI crawlers.

### Verification

After any change, confirm `llms.txt` is reachable from the canonical LLM UAs:

```bash
for ua in \
  "ClaudeBot/1.0; +https://anthropic.com/claude-web" \
  "Mozilla/5.0 (compatible; Claude-User/1.0; +https://anthropic.com)" \
  "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)" \
  ""; do
  echo -n "${ua:0:30}…  "
  curl -fsI -A "$ua" https://specflow.makerlabs.dev/llms.txt 2>&1 | head -1
done
```

All four should return `HTTP/2 200`. Same for `/version.json` and the HTML root.

### Rollback

Bot Management → AI Crawlers → click `Block` on the desired row(s). Effect is immediate. No CDN
cache propagation delay.

## DNS

The `specflow` CNAME points at GitHub Pages (`mkrlabs.github.io.`). The custom domain is enforced
server-side via the `docs-dist/CNAME` file emitted by `scripts/build-docs.ts` on every docs deploy —
see the file's docstring for why the artifact CNAME is the source of truth.

## Routine ops

The docs site has no scheduled maintenance. The deployment workflow (`.github/workflows/static.yml`)
redeploys on every push to `main` that touches `docs/` and on every release. The `version.json`
endpoint is regenerated in lockstep with each deploy — see #168 / PR #169 for the contract.
