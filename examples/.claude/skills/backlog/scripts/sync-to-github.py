#!/usr/bin/env python3
"""
backlog sync — one-way push from tasks/backlog/*.md → GitHub Issues
+ GitHub Project #3 Kanban board.

Idempotent: uses label `backlog/<NNN>` to detect existing issues.
Creates missing issues, updates existing ones (title, body, labels,
status column), skips items that haven't changed.

Usage:
    python3 .claude/skills/backlog/scripts/sync-to-github.py [--dry-run] [--id NNN]

Requires:
    gh CLI authenticated with `project` + `repo` scopes
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = "miximodel/miximodel"
PROJECT_NUMBER = 3
PROJECT_ORG = "miximodel"

# Project field IDs
STATUS_FIELD_ID = "PVTSSF_lADOCeVM-s4BUSEvzhBbVcQ"
PRIORITY_FIELD_ID = "PVTSSF_lADOCeVM-s4BUSEvzhBbWpU"
SIZE_FIELD_ID = "PVTSSF_lADOCeVM-s4BUSEvzhBbWpY"
ESTIMATE_FIELD_ID = "PVTF_lADOCeVM-s4BUSEvzhBbWpc"

# Status column option IDs
STATUS_MAP = {
    "todo": "f75ad846",        # Backlog
    "blocked": "f75ad846",     # Backlog
    "in_progress": "47fc9ee4", # In progress
    "done": "98236657",        # Done
    "deferred": "f75ad846",    # Backlog
}

# Priority mapping
PRIORITY_MAP = {
    "critical": "79628723",  # P0
    "high": "0a877460",      # P1
    "medium": "da944a9c",    # P2
    "low": "da944a9c",       # P2
}

# Complexity → Size mapping
SIZE_MAP = {
    "1": "6c6483d2",   # XS
    "2": "6c6483d2",   # XS
    "3": "f784b110",   # S
    "5": "7515a9f1",   # M
    "8": "817d0097",   # L
    "13": "db339eb2",  # XL
    "21": "db339eb2",  # XL
}

# Priority → label color
PRIORITY_COLORS = {
    "critical": "b60205",
    "high": "d93f0b",
    "medium": "fbca04",
    "low": "0e8a16",
}


def gh(*args, **kwargs):
    """Run a gh CLI command and return stdout."""
    result = subprocess.run(
        ["gh", *args],
        capture_output=True, text=True,
        **kwargs
    )
    if result.returncode != 0 and "--jq" not in args:
        print(f"  ⚠ gh {' '.join(args[:3])}... failed: {result.stderr.strip()}", file=sys.stderr)
    return result.stdout.strip()


def gh_graphql(query):
    """Run a GraphQL query via gh api."""
    result = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={query}"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def get_project_id():
    data = gh_graphql(f'''
        query {{
            organization(login: "{PROJECT_ORG}") {{
                projectV2(number: {PROJECT_NUMBER}) {{ id }}
            }}
        }}
    ''')
    return data["data"]["organization"]["projectV2"]["id"] if data else None


def parse_frontmatter(filepath):
    """Parse YAML-ish frontmatter from a task MD file."""
    content = filepath.read_text()
    match = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)
    if not match:
        return None

    fm_text = match.group(1)
    body = match.group(2).strip()

    def get(key):
        m = re.search(rf"^{key}:\s*(.+)$", fm_text, re.MULTILINE)
        if not m:
            return ""
        return m.group(1).strip().strip("'").strip('"')

    tags_m = re.search(r"^tags:\s*\[(.+)\]", fm_text, re.MULTILINE)
    tags = [t.strip().strip("'").strip('"') for t in tags_m.group(1).split(",")] if tags_m else []

    deps_m = re.search(r"^depends_on:\s*\[(.*)\]", fm_text, re.MULTILINE)
    deps_raw = deps_m.group(1).strip() if deps_m else ""
    depends_on = (
        [d.strip().strip("'").strip('"') for d in deps_raw.split(",") if d.strip()]
        if deps_raw
        else []
    )

    return {
        "id": get("id"),
        "title": get("title"),
        "category": get("category"),
        "priority": get("priority"),
        "complexity": get("complexity"),
        "status": get("status"),
        "tags": tags,
        "depends_on": depends_on,
        "body": body,
    }


def ensure_label(name, color="ededed", dry_run=False):
    """Create label if it doesn't exist."""
    existing = gh("label", "list", "--repo", REPO, "--json", "name", "--jq", ".[].name")
    if name in existing.split("\n"):
        return
    if dry_run:
        print(f"  [dry-run] Would create label: {name}")
        return
    gh("label", "create", name, "--repo", REPO, "--color", color,
       "--description", "Auto-synced from backlog", "--force")


def get_issue_node_id(issue_number):
    """Resolve a repo issue number to its GraphQL node ID."""
    data = gh_graphql(f'''
        query {{
            repository(owner: "miximodel", name: "miximodel") {{
                issue(number: {issue_number}) {{ id }}
            }}
        }}
    ''')
    if not data:
        return None
    issue = data.get("data", {}).get("repository", {}).get("issue")
    return issue.get("id") if issue else None


def get_current_blocked_by(issue_number):
    """Return the set of issue numbers that currently block the given
    issue via GitHub's native Relationships API."""
    data = gh_graphql(f'''
        query {{
            repository(owner: "miximodel", name: "miximodel") {{
                issue(number: {issue_number}) {{
                    blockedBy(first: 50) {{
                        nodes {{ number }}
                    }}
                }}
            }}
        }}
    ''')
    if not data:
        return set()
    issue = data.get("data", {}).get("repository", {}).get("issue")
    if not issue or not issue.get("blockedBy"):
        return set()
    return {n["number"] for n in issue["blockedBy"]["nodes"]}


def add_blocked_by(blocked_node_id, blocking_node_id):
    """Record that `blocked_node_id` is blocked by `blocking_node_id`
    via the native Relationships API (shows under the "Relationships"
    sidebar on the issue page). Idempotent on GitHub's side — calling
    twice does not create a duplicate relation."""
    return gh_graphql(f'''
        mutation {{
            addBlockedBy(input: {{
                issueId: "{blocked_node_id}"
                blockingIssueId: "{blocking_node_id}"
            }}) {{
                issue {{ number }}
            }}
        }}
    ''')


def remove_blocked_by(blocked_node_id, blocking_node_id):
    """Drop a blocker relation that no longer exists in the frontmatter."""
    return gh_graphql(f'''
        mutation {{
            removeBlockedBy(input: {{
                issueId: "{blocked_node_id}"
                blockingIssueId: "{blocking_node_id}"
            }}) {{
                issue {{ number }}
            }}
        }}
    ''')


def reconcile_blocked_by(issue_number, depends_on, label_to_issue):
    """Align GitHub's native Blocked-by relationships with the
    frontmatter's `depends_on` list.

    Resolves numeric backlog IDs to issue numbers, then computes the
    diff with the current blockers and applies adds/removes. Semantic
    (non-numeric) deps are ignored here — they are only rendered in
    the body fallback section."""
    desired = set()
    for dep in depends_on:
        if re.fullmatch(r"\d+", dep):
            padded = dep.zfill(3)
            num = label_to_issue.get(f"backlog/{padded}")
            if num:
                desired.add(num)

    current = get_current_blocked_by(issue_number)
    to_add = desired - current
    to_remove = current - desired

    if not to_add and not to_remove:
        return

    blocked_id = get_issue_node_id(issue_number)
    if not blocked_id:
        return

    for blocker_num in to_add:
        blocker_id = get_issue_node_id(blocker_num)
        if blocker_id:
            add_blocked_by(blocked_id, blocker_id)

    for blocker_num in to_remove:
        blocker_id = get_issue_node_id(blocker_num)
        if blocker_id:
            remove_blocked_by(blocked_id, blocker_id)


def build_label_to_issue_map():
    """Build a single-pass map {backlog/NNN: issue_number} from all
    issues on the repo that carry a `backlog/*` label. GitHub's issue
    search does not support label-prefix matching, so we list every
    issue + closed issue and filter client-side.
    """
    out = gh(
        "issue", "list", "--repo", REPO,
        "--state", "all",
        "--limit", "500",
        "--json", "number,labels",
    )
    mapping = {}
    if not out:
        return mapping
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return mapping
    for entry in data:
        for lbl in entry.get("labels", []):
            name = lbl.get("name", "") if isinstance(lbl, dict) else ""
            if name.startswith("backlog/"):
                mapping[name] = entry["number"]
    return mapping


def render_blocked_by_section(depends_on, label_to_issue):
    """Turn the frontmatter `depends_on` list into a Markdown
    "Blocked by" section. Numeric IDs resolve to GitHub issue
    references (auto-linked by GitHub). Non-numeric semantic IDs
    (e.g. 'bookings') are rendered as plain text for visibility."""
    if not depends_on:
        return ""

    lines = []
    for dep in depends_on:
        if re.fullmatch(r"\d+", dep):
            # Normalize to 3-digit zero-padded backlog ID
            padded = dep.zfill(3)
            issue_num = label_to_issue.get(f"backlog/{padded}")
            if issue_num:
                lines.append(f"- #{issue_num} (backlog task {padded})")
            else:
                lines.append(f"- backlog task {padded} _(not yet synced)_")
        else:
            # Semantic reference (feature area, not a backlog task)
            lines.append(f"- `{dep}` _(semantic dependency, no backlog ticket)_")

    return "> **Blocked by:**\n" + "\n".join(f"> {line}" for line in lines) + "\n\n"


def find_issue_by_label(label):
    """Find an existing issue by its backlog tracking label."""
    out = gh("issue", "list", "--repo", REPO, "--label", label,
             "--state", "all", "--json", "number", "--jq", ".[0].number")
    return int(out) if out and out.isdigit() else None


def get_project_item_id(issue_number):
    """Get the project item ID for an issue."""
    data = gh_graphql(f'''
        query {{
            organization(login: "{PROJECT_ORG}") {{
                projectV2(number: {PROJECT_NUMBER}) {{
                    items(first: 100) {{
                        nodes {{
                            id
                            content {{ ... on Issue {{ number }} }}
                        }}
                    }}
                }}
            }}
        }}
    ''')
    if not data:
        return None
    for node in data["data"]["organization"]["projectV2"]["items"]["nodes"]:
        content = node.get("content") or {}
        if content.get("number") == issue_number:
            return node["id"]
    return None


def add_to_project(issue_number, project_id):
    """Add an issue to the project board."""
    issue_data = gh_graphql(f'''
        query {{
            repository(owner: "miximodel", name: "miximodel") {{
                issue(number: {issue_number}) {{ id }}
            }}
        }}
    ''')
    if not issue_data:
        return None
    issue_id = issue_data["data"]["repository"]["issue"]["id"]

    result = gh_graphql(f'''
        mutation {{
            addProjectV2ItemById(input: {{
                projectId: "{project_id}"
                contentId: "{issue_id}"
            }}) {{ item {{ id }} }}
        }}
    ''')
    if result:
        return result["data"]["addProjectV2ItemById"]["item"]["id"]
    return None


def set_field(project_id, item_id, field_id, option_id):
    """Set a single-select field on a project item."""
    gh_graphql(f'''
        mutation {{
            updateProjectV2ItemFieldValue(input: {{
                projectId: "{project_id}"
                itemId: "{item_id}"
                fieldId: "{field_id}"
                value: {{ singleSelectOptionId: "{option_id}" }}
            }}) {{ projectV2Item {{ id }} }}
        }}
    ''')


def set_number_field(project_id, item_id, field_id, value):
    """Set a number field on a project item."""
    gh_graphql(f'''
        mutation {{
            updateProjectV2ItemFieldValue(input: {{
                projectId: "{project_id}"
                itemId: "{item_id}"
                fieldId: "{field_id}"
                value: {{ number: {value} }}
            }}) {{ projectV2Item {{ id }} }}
        }}
    ''')


def update_project_fields(project_id, item_id, task):
    """Set status, priority, size, and estimate on a project item."""
    status_opt = STATUS_MAP.get(task["status"], "f75ad846")
    set_field(project_id, item_id, STATUS_FIELD_ID, status_opt)

    priority_opt = PRIORITY_MAP.get(task["priority"])
    if priority_opt:
        set_field(project_id, item_id, PRIORITY_FIELD_ID, priority_opt)

    size_opt = SIZE_MAP.get(task["complexity"])
    if size_opt:
        set_field(project_id, item_id, SIZE_FIELD_ID, size_opt)

    if task["complexity"]:
        try:
            set_number_field(project_id, item_id, ESTIMATE_FIELD_ID, int(task["complexity"]))
        except (ValueError, TypeError):
            pass


def sync_task(task, project_id, label_to_issue, dry_run=False):
    """Sync a single task to GitHub Issues + Project board."""
    task_id = task["id"]
    backlog_label = f"backlog/{task_id}"

    print(f"→ [{task_id}] {task['title']} (status={task['status']}, priority={task['priority']}, complexity={task['complexity']})")

    # Ensure labels exist
    ensure_label(backlog_label, "1d76db", dry_run)
    if task["category"]:
        ensure_label(task["category"], "5319e7", dry_run)
    if task["priority"]:
        ensure_label(task["priority"], PRIORITY_COLORS.get(task["priority"], "ededed"), dry_run)

    # Build labels list
    labels = [backlog_label]
    if task["category"]:
        labels.append(task["category"])
    if task["priority"]:
        labels.append(task["priority"])

    # Build issue body
    blocked_by = render_blocked_by_section(task.get("depends_on", []), label_to_issue)
    issue_body = (
        f"<!-- backlog-sync: {task_id} -->\n"
        f"> **Backlog Task {task_id}** | Priority: {task['priority']} | "
        f"Complexity: {task['complexity']} pts | Category: {task['category']}\n\n"
        f"{blocked_by}"
        f"{task['body']}"
    )

    existing_issue = find_issue_by_label(backlog_label)

    if existing_issue:
        # Update
        if dry_run:
            print(f"  [dry-run] Would update issue #{existing_issue}")
            return "updated"

        gh("issue", "edit", str(existing_issue), "--repo", REPO,
           "--title", f"[{task_id}] {task['title']}",
           "--body", issue_body,
           "--add-label", ",".join(labels))

        if task["status"] == "done":
            gh("issue", "close", str(existing_issue), "--repo", REPO,
               "--reason", "completed")
        else:
            gh("issue", "reopen", str(existing_issue), "--repo", REPO)

        item_id = get_project_item_id(existing_issue)
        if item_id:
            update_project_fields(project_id, item_id, task)

        reconcile_blocked_by(existing_issue, task.get("depends_on", []), label_to_issue)

        print(f"  ✔ Updated issue #{existing_issue}")
        return "updated"
    else:
        # Create
        if dry_run:
            print(f"  [dry-run] Would create issue: [{task_id}] {task['title']}")
            return "created"

        out = gh("issue", "create", "--repo", REPO,
                 "--title", f"[{task_id}] {task['title']}",
                 "--body", issue_body,
                 "--label", ",".join(labels))

        # Extract issue number from URL
        match = re.search(r"/issues/(\d+)", out)
        if not match:
            print(f"  ✖ Failed to create issue (output: {out})")
            return None

        new_issue = int(match.group(1))

        if task["status"] == "done":
            gh("issue", "close", str(new_issue), "--repo", REPO,
               "--reason", "completed")

        item_id = add_to_project(new_issue, project_id)
        if item_id:
            update_project_fields(project_id, item_id, task)

        reconcile_blocked_by(new_issue, task.get("depends_on", []), label_to_issue)

        print(f"  ✔ Created issue #{new_issue} → added to project")
        return "created"


def main():
    parser = argparse.ArgumentParser(description="Sync backlog tasks to GitHub Issues")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen")
    parser.add_argument("--id", dest="filter_id", help="Sync only the specified task ID")
    args = parser.parse_args()

    tasks_dir = Path("tasks/backlog")
    if not tasks_dir.is_dir():
        print(f"Error: {tasks_dir} not found. Run from repo root.", file=sys.stderr)
        sys.exit(1)

    project_id = get_project_id()
    if not project_id and not args.dry_run:
        print("Error: could not resolve GitHub Project ID", file=sys.stderr)
        sys.exit(1)

    print(f"Syncing backlog → GitHub Issues + Project #{PROJECT_NUMBER}")
    print()

    # Pre-fetch the backlog-label → issue-number map once so we can
    # resolve `depends_on` references into real `#NN` links during the
    # loop without N extra API calls.
    label_to_issue = {} if args.dry_run else build_label_to_issue_map()

    stats = {"synced": 0, "created": 0, "updated": 0, "skipped": 0}

    for task_file in sorted(tasks_dir.glob("*.md")):
        if task_file.name == "backlog.md":
            continue

        task = parse_frontmatter(task_file)
        if not task or not task["id"]:
            print(f"  ⚠ Skipping {task_file.name} (parse error)")
            stats["skipped"] += 1
            continue

        if args.filter_id and task["id"] != args.filter_id:
            continue

        result = sync_task(task, project_id, label_to_issue, args.dry_run)
        stats["synced"] += 1
        if result == "created":
            stats["created"] += 1
        elif result == "updated":
            stats["updated"] += 1

    print()
    print("════════════════════════════════════")
    print(f"  Sync complete")
    print(f"  Processed: {stats['synced']}")
    print(f"  Created:   {stats['created']}")
    print(f"  Updated:   {stats['updated']}")
    print(f"  Skipped:   {stats['skipped']}")
    print("════════════════════════════════════")


if __name__ == "__main__":
    main()
