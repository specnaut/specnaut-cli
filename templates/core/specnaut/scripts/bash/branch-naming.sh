# shellcheck shell=bash
#
# Sourced by create-new-feature.sh, beside it: how a feature branch is named —
# the next free number and the slug after it. Its PowerShell twin is
# branch-naming.ps1, and the two are held to the same scenarios by
# tests/scripts/create_new_feature_number_reuse_test.ts.
#
# Kept out of create-new-feature.sh so the script reads as the run it performs
# (parse, name, detect the epic, create, move the card, report), and so a
# change to numbering is made in one short file and its twin, not in the middle
# of a long one. Defines functions only: sourcing it runs nothing.

# Function to get highest number from specs directory
get_highest_from_specs() {
    local specs_dir="$1"
    local highest=0
    
    if [ -d "$specs_dir" ]; then
        for dir in "$specs_dir"/*; do
            [ -d "$dir" ] || continue
            dirname=$(basename "$dir")
            # Match sequential prefixes (>=3 digits), but skip timestamp dirs.
            if echo "$dirname" | grep -Eq '^[0-9]{3,}-' && ! echo "$dirname" | grep -Eq '^[0-9]{8}-[0-9]{6}-'; then
                number=$(echo "$dirname" | grep -Eo '^[0-9]+')
                number=$((10#$number))
                if [ "$number" -gt "$highest" ]; then
                    highest=$number
                fi
            fi
        done
    fi
    
    echo "$highest"
}

# Function to get highest number from git branches
get_highest_from_branches() {
    git branch -a 2>/dev/null | sed 's/^[* ]*//; s|^remotes/[^/]*/||' | _extract_highest_number
}

# Extract the highest sequential feature number from a list of ref names (one per line).
# Shared by get_highest_from_branches, get_highest_from_remote_refs and
# get_highest_from_history.
_extract_highest_number() {
    local highest=0
    while IFS= read -r name; do
        [ -z "$name" ] && continue
        if echo "$name" | grep -Eq '^[0-9]{3,}-' && ! echo "$name" | grep -Eq '^[0-9]{8}-[0-9]{6}-'; then
            number=$(echo "$name" | grep -Eo '^[0-9]+' || echo "0")
            number=$((10#$number))
            if [ "$number" -gt "$highest" ]; then
                highest=$number
            fi
        fi
    done
    echo "$highest"
}

# Function to get highest number from remote branches without fetching (side-effect-free)
get_highest_from_remote_refs() {
    local highest=0

    for remote in $(git remote 2>/dev/null); do
        local remote_highest
        remote_highest=$(GIT_TERMINAL_PROMPT=0 git ls-remote --heads "$remote" 2>/dev/null | sed 's|.*refs/heads/||' | _extract_highest_number)
        if [ "$remote_highest" -gt "$highest" ]; then
            highest=$remote_highest
        fi
    done

    echo "$highest"
}

# Highest feature number any spec directory has EVER carried, per git history.
#
# The merge-close phase removes a shipped feature's spec directory and the
# post-merge cleanup deletes its branch, so neither the tree nor the refs still
# hold that number — only the commit that added the directory does. Without
# this, the next feature is handed the shipped number again and every citation
# of it ("plan 041 FR-004") becomes ambiguous.
#
# History rather than a stored counter: it needs no extra committed file (which
# two parallel feature branches would both bump, and conflict on), and a fresh
# clone carries it. --all includes remote-tracking refs, so a clone that has
# only `main` checked out still sees `origin/main`.
#
# Cost is one path-limited walk: git prunes each commit's diff to the specs
# subtree, and uses changed-path Bloom filters when a commit-graph has them.
#   --diff-filter=A  only the commit that introduced a file names it; the rest
#                    of a plan's edits add nothing to read.
#   --no-renames     plans start from one template, so dropping one and adding
#                    another in a single commit is a "rename" to the default
#                    diff — and the new directory never shows up as an addition.
#   core.quotePath   a non-ASCII name would otherwise be quoted and not match.
get_highest_from_history() {
    git -c core.quotePath=false log --all --no-renames --diff-filter=A \
        --name-only --format= -- .specnaut/specs 2>/dev/null \
        | sed -n 's|^\.specnaut/specs/\([^/]*\)/.*|\1|p' \
        | sort -u \
        | _extract_highest_number
}

# Function to check existing branches (local and remote) and return next available number.
# When skip_fetch is true, queries remotes via ls-remote (read-only) instead of fetching.
check_existing_branches() {
    local specs_dir="$1"
    local skip_fetch="${2:-false}"
    local highest_remote highest_branch highest_spec highest_history

    if [ "$skip_fetch" = true ]; then
        # Side-effect-free: query remotes via ls-remote
        highest_remote=$(get_highest_from_remote_refs)
        highest_branch=$(get_highest_from_branches)
        if [ "$highest_remote" -gt "$highest_branch" ]; then
            highest_branch=$highest_remote
        fi
    else
        # Fetch all remotes to get latest branch info (suppress errors if no remotes)
        git fetch --all --prune >/dev/null 2>&1 || true
        highest_branch=$(get_highest_from_branches)
    fi

    # Get highest number from ALL specs (not just matching short name)
    highest_spec=$(get_highest_from_specs "$specs_dir")

    # ...and from every spec directory history has seen, including shipped
    # ones whose directory and branch are both gone. Read after the fetch
    # above, so freshly fetched remote history counts too.
    highest_history=$(get_highest_from_history)

    # Take the maximum of all three
    local max_num=$highest_branch
    if [ "$highest_spec" -gt "$max_num" ]; then
        max_num=$highest_spec
    fi
    if [ "$highest_history" -gt "$max_num" ]; then
        max_num=$highest_history
    fi

    echo $((max_num + 1)) # the next free number
}

# Function to clean and format a branch name
clean_branch_name() {
    local name="$1"
    echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-//' | sed 's/-$//'
}

# Function to generate branch name with stop word filtering and length filtering
generate_branch_name() {
    local description="$1"
    local clean_name cleaned
    # Common stop words to filter out
    local stop_words="^(i|a|an|the|to|for|of|in|on|at|by|with|from|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|should|could|can|may|might|must|shall|this|that|these|those|my|your|our|their|want|need|add|get|set)$"
    
    # Convert to lowercase and split into words
    clean_name=$(echo "$description" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/ /g')
    
    # Filter words: remove stop words and words shorter than 3 chars (unless they're uppercase acronyms in original)
    local meaningful_words=()
    for word in $clean_name; do
        # Skip empty words
        [ -z "$word" ] && continue
        
        # Keep words that are NOT stop words AND (length >= 3 OR are potential acronyms)
        if ! echo "$word" | grep -qiE "$stop_words"; then
            if [ ${#word} -ge 3 ]; then
                meaningful_words+=("$word")
            elif echo "$description" | grep -q "\b${word^^}\b"; then
                # Keep short words if they appear as uppercase in original (likely acronyms)
                meaningful_words+=("$word")
            fi
        fi
    done
    
    # If we have meaningful words, use first 3-4 of them
    if [ ${#meaningful_words[@]} -gt 0 ]; then
        local max_words=3
        if [ ${#meaningful_words[@]} -eq 4 ]; then max_words=4; fi
        
        local result=""
        local count=0
        for word in "${meaningful_words[@]}"; do
            if [ $count -ge $max_words ]; then break; fi
            if [ -n "$result" ]; then result="$result-"; fi
            result="$result$word"
            count=$((count + 1))
        done
        echo "$result"
    else
        # Fallback to original logic if no meaningful words found
        cleaned=$(clean_branch_name "$description")
        echo "$cleaned" | tr '-' '\n' | grep -v '^$' | head -3 | tr '\n' '-' | sed 's/-$//'
    fi
}
