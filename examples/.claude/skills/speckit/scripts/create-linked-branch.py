#!/usr/bin/env python3
"""
create-linked-branch — Phase 1 of /speckit specify --copilot.

Resolves a backlog task ID to its GitHub Issue (via `backlog/NNN` label),
then creates a branch natively linked to that issue using the GitHub
GraphQL `createLinkedBranch` mutation. Fetches the branch locally and
checks it out.

Usage:
    python3 .claude/skills/speckit/scripts/create-linked-branch.py \\
        --backlog-id NNN \\
        --slug short-feature-slug \\
        [--dry-run]

Output (stdout, JSON on success):
    {"branch": "42-short-feature-slug", "issue_number": 42, "issue_url": "..."}

Exit codes:
    0 — success
    1 — generic failure
    2 — backlog task not synced to GitHub yet
    3 — GitHub API / network failure
"""

import argparse
import json
import re
import subprocess
import sys

REPO = "miximodel/miximodel"


def gh(*args, capture=True):
    """Run gh CLI and return stdout; raise on non-zero exit."""
    result = subprocess.run(
        ["gh", *args],
        capture_output=capture, text=True,
    )
    if result.returncode != 0:
        print(f"gh {args[0]} failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(3)
    return result.stdout.strip()


def resolve_issue(backlog_id: str) -> dict:
    """Find the open issue with label backlog/<NNN>."""
    label = f"backlog/{backlog_id}"
    raw = gh(
        "issue", "list",
        "--repo", REPO,
        "--label", label,
        "--state", "all",
        "--limit", "1",
        "--json", "number,title,url,id",
    )
    issues = json.loads(raw)
    if not issues:
        print(
            f"No GitHub Issue found with label '{label}'. "
            f"Run /backlog sync {backlog_id} first.",
            file=sys.stderr,
        )
        sys.exit(2)
    return issues[0]


def get_default_branch_oid() -> str:
    """Return the commit SHA at the tip of the default branch (main)."""
    raw = gh(
        "api", "repos/" + REPO + "/commits/main",
        "--jq", ".sha",
    )
    return raw


def remote_branch_exists(branch_name: str) -> bool:
    """Return True if origin already has a branch with this name."""
    result = subprocess.run(
        ["git", "ls-remote", "--heads", "origin", branch_name],
        capture_output=True, text=True,
    )
    return result.returncode == 0 and result.stdout.strip() != ""


def create_linked_branch(issue_node_id: str, branch_name: str, oid: str, dry_run: bool) -> str:
    """Call the createLinkedBranch GraphQL mutation. Idempotent: if the
    branch already exists on origin, skip the mutation and return the name."""
    if dry_run:
        print(f"[dry-run] would createLinkedBranch name={branch_name} issue={issue_node_id} oid={oid}")
        return branch_name
    if remote_branch_exists(branch_name):
        print(
            f"Branch '{branch_name}' already exists on origin — skipping "
            f"createLinkedBranch (idempotent). Will fetch + checkout.",
            file=sys.stderr,
        )
        return branch_name
    mutation = """
    mutation($issueId: ID!, $oid: GitObjectID!, $name: String!) {
      createLinkedBranch(input: {issueId: $issueId, oid: $oid, name: $name}) {
        linkedBranch { ref { name } }
      }
    }
    """
    raw = gh(
        "api", "graphql",
        "-f", f"query={mutation}",
        "-F", f"issueId={issue_node_id}",
        "-F", f"oid={oid}",
        "-F", f"name={branch_name}",
    )
    data = json.loads(raw)
    if "errors" in data:
        print(f"GraphQL error: {data['errors']}", file=sys.stderr)
        sys.exit(3)
    return data["data"]["createLinkedBranch"]["linkedBranch"]["ref"]["name"]


def fetch_and_checkout(branch: str, dry_run: bool):
    """git fetch + git checkout the new remote branch."""
    if dry_run:
        print(f"[dry-run] would: git fetch origin {branch} && git checkout {branch}")
        return
    subprocess.run(["git", "fetch", "origin", branch], check=True)
    subprocess.run(["git", "checkout", branch], check=True)


def slugify(s: str) -> str:
    """Normalize a feature slug: lowercase, kebab-case, alnum + hyphens only."""
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return s[:60]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backlog-id", required=True, help="3-digit backlog task ID (e.g. 073)")
    parser.add_argument("--slug", required=True, help="Short feature slug for the branch")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    issue = resolve_issue(args.backlog_id)
    slug = slugify(args.slug)
    branch = f"{issue['number']}-{slug}"

    oid = get_default_branch_oid()
    created = create_linked_branch(issue["id"], branch, oid, args.dry_run)
    fetch_and_checkout(created, args.dry_run)

    print(json.dumps({
        "branch": created,
        "issue_number": issue["number"],
        "issue_url": issue["url"],
    }))


if __name__ == "__main__":
    main()
