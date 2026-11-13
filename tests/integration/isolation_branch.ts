import { blob, commit, mktree, type RawEntry } from "../helpers/git_fixture.ts";

/**
 * A branch whose code tries to reach what a run must never give it, beside a test of its own that
 * only a real run of its tree can pass. Built with `git mktree`, as any pushed branch can be.
 *
 * `probe.sh` takes `<kind>=<target>` words and prints `probe started`, then one line per word:
 * `<kind> <target> ok [<what it got>]`, or `<kind> <target> fail <exit code> [<reason>]`. The same
 * file is run inside the sandbox and, as the control, on the host: a probe that cannot succeed
 * anywhere would pass for isolation, so every kind is shown succeeding where access is granted.
 * The code tells a refusal (a tool's own 1 or 2) from a tool the run could not start (126, 127),
 * so every tool is called by its absolute path, one a macOS host and a merged-`/usr` Linux both
 * have. Kinds: `read` a file, `list` a folder, `env` (the environment holds the text), `connect`
 * to `host:port`, `rewrite`/`dotgit`/`plantlink` in a folder (`TMPDIR` is the run's temp), `grep`
 * the tree, `ifaces` the network interfaces that are up, `lookup` a macOS service, `job` a
 * launchd submission, `loopback` over `tcp` or `unix`. The socket kinds print the system's reason.
 */

/** What only a real run of this branch's tree prints: the nonce it holds, and the run's home. */
export const TEST_SH = `#!/bin/sh
printf 'control ran: %s with home %s\\n' "$(/bin/cat nonce.txt)" "$HOME"
`;

/** Perl snippets: exit 0 on success, else print the reason (`$!`) and exit 1. */
const PERL_CONNECT =
  'IO::Socket::INET->new(PeerAddr => $ARGV[0], Timeout => 3) or (print "$!" and exit 1)';
const PERL_TCP =
  'my $l = IO::Socket::INET->new(Listen => 1, LocalAddr => "127.0.0.1") or (print "$!" and exit 1); ' +
  'IO::Socket::INET->new(PeerAddr => "127.0.0.1", PeerPort => $l->sockport) or (print "$!" and exit 1)';
/** A relative name, so the bind cannot fail for the length of the folder's path. */
const PERL_UNIX = 'unlink "probe.sock"; ' +
  'my $l = IO::Socket::UNIX->new(Local => "probe.sock", Listen => 1) or (print "$!" and exit 1); ' +
  'IO::Socket::UNIX->new(Peer => "probe.sock") or (print "$!" and exit 1)';

export const PROBE_SH = `#!/bin/sh
echo "probe started"
PERL=/usr/bin/perl
up_interfaces() { for i in /sys/class/net/*; do
  read -r f 2>/dev/null < "$i/flags" && [ $((f & 1)) -eq 1 ] && printf '%s ' "\${i##*/}"; done; }
folder() { if [ "$1" = TMPDIR ]; then echo "$TMPDIR"; else echo "$1"; fi; }
# Runs the command; r is ok, or fail with its exit code and what it printed.
try() { v=$("$@" 2>/dev/null); c=$?; if [ $c -eq 0 ]; then r=ok; else r="fail $c $v"; fi; }
for word in "$@"; do
  kind=\${word%%=*}; target=\${word#*=}; r=
  case $kind in
    read) try /bin/cat -- "$target"
      [ "$r" = ok ] && r="ok $(printf '%s' "$v" | /usr/bin/tr -d '\\n')" ;;
    list) try /bin/ls -- "$target" ;;
    env) try /usr/bin/env
      [ "$r" = ok ] && { printf '%s\\n' "$v" | /usr/bin/grep -q -- "$target"; c=$?
        [ $c -eq 0 ] || r="fail $c"; } ;;
    connect) try $PERL -MIO::Socket::INET -e '${PERL_CONNECT}' "$target" ;;
    rewrite) try /bin/sh -c 'printf "rewritten\\n" > "$1/hello.txt"' - "$(folder "$target")" ;;
    dotgit) try /bin/mkdir "$(folder "$target")/.git"
      [ "$r" = ok ] && try /bin/sh -c 'printf "[core]\\n" > "$1/.git/config"' - "$(folder "$target")" ;;
    plantlink) try /bin/ln -s /etc/hosts "$(folder "$target")/planted-link" ;;
    grep) v=$(/usr/bin/grep -rl -- "$target" . 2>/dev/null); c=$?
      if [ $c -eq 0 ]; then r=$(printf '%s\\n' "$v" | /usr/bin/sort | /usr/bin/tr '\\n' ' ')
      elif [ $c -eq 1 ]; then r=none; else r="fail $c"; fi ;;
    ifaces) r=$(up_interfaces); r=\${r:-none} ;;
    lookup) r=$(./lookup "$target" 2>/dev/null) || r="fail $?" ;;
    job) try /bin/launchctl submit -l "$target" -- /usr/bin/true
      [ "$r" = ok ] && try /bin/launchctl list "$target" ;;
    loopback) if [ "$target" = tcp ]; then try $PERL -MIO::Socket::INET -e '${PERL_TCP}'
      else try /bin/sh -c 'cd "$TMPDIR" && exec "$0" -MIO::Socket::UNIX -e "$1"' $PERL '${PERL_UNIX}'; fi ;;
  esac
  echo "$kind $target $r"
done
`;

/** What the branch carries beside its scripts, each chosen per test. */
export type BranchText = {
  readonly nonce: string;
  /** In every instruction file: never written, so never found. */
  readonly canary: string;
  /** In a plain file beside them: written, so found by the same search. */
  readonly control: string;
  /** Where the branch's link points: a file planted on the host. */
  readonly linkTarget: string;
  /** A macOS service-lookup program the branch carries, when one could be built. */
  readonly lookup?: Uint8Array;
};

type Entry = (name: string, body: string | Uint8Array, mode?: string) => Promise<RawEntry>;
type Folder = (name: string, entries: RawEntry[]) => Promise<RawEntry>;

/** The branch's commit in `repo`. */
export async function probingBranch(repo: string, text: BranchText): Promise<string> {
  const file: Entry = async (name, body, mode = "100644") => [mode, name, await blob(repo, body)];
  const dir: Folder = async (name, entries) => ["40000", name, await mktree(repo, entries)];
  const root: RawEntry[] = [
    await file("hello.txt", "from the branch\n"),
    await file("nonce.txt", text.nonce),
    await file("test.sh", TEST_SH, "100755"),
    await file("probe.sh", PROBE_SH, "100755"),
    await file("link-to-token", text.linkTarget, "120000"),
    ...await instructions(file, dir, text),
    await dir("nested", await repositoryLayout(repo)),
    ...(text.lookup ? [await file("lookup", text.lookup, "100755")] : []),
  ];
  return await commit(repo, await mktree(repo, root));
}

/** Instruction files holding the canary, with a plain file holding the control beside one. */
async function instructions(file: Entry, dir: Folder, text: BranchText): Promise<RawEntry[]> {
  const canary = `${text.canary}\n`;
  return [
    await file("AGENTS.md", canary),
    await file(".mcp.json", canary),
    await dir(".claude", [await file("settings.json", canary)]),
    await dir("sub", [
      await file("CLAUDE.md", canary),
      await file("notes.md", `${text.control}\n`),
    ]),
  ];
}

/** A folder git would take for a repository, whose config names a program for git to run. */
async function repositoryLayout(repo: string): Promise<RawEntry[]> {
  const keep = await blob(repo, "");
  const sub = async (name: string) =>
    ["40000", name, await mktree(repo, [["100644", "keep", keep]])] as RawEntry;
  return [
    ["100644", "HEAD", await blob(repo, "ref: refs/heads/main\n")],
    ["100644", "config", await blob(repo, "[core]\n\tfsmonitor = /bin/true\n")],
    await sub("objects"),
    await sub("refs"),
  ];
}
