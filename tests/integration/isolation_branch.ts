import { blob, commit, mktree, type RawEntry } from "../helpers/git_fixture.ts";

/**
 * A branch whose code tries to reach what a run must never give it, beside a test of its own that
 * only a real run of its tree can pass. Built with `git mktree`, as any pushed branch can be.
 *
 * `probe.sh` takes `<kind>=<target>` words and prints `probe started`, then one line per word:
 * `<kind> <target> <result>`. The same file is run inside the sandbox and, as the control, on the
 * host: a probe that cannot succeed anywhere would pass for isolation, so every kind is shown
 * succeeding where access is granted. Kinds: `read` a file, `list` a folder, `env` (the host
 * environment holds the text), `connect` to `host:port`, `rewrite`/`dotgit`/`plantlink` in a folder
 * (`TMPDIR` is the run's temp), `grep` the tree, `ifaces` the network interfaces that are up, `lookup` a macOS
 * service, `job` a launchd submission, `loopback` over `tcp` or `unix`.
 */

/** What only a real run of this branch's tree prints: the nonce it holds, and the run's home. */
export const TEST_SH = `#!/bin/sh
printf 'control ran: %s with home %s\\n' "$(cat nonce.txt)" "$HOME"
`;

const PERL_CONNECT = "exit(IO::Socket::INET->new(PeerAddr => $ARGV[0], Timeout => 3) ? 0 : 1)";
const PERL_TCP =
  'my $l = IO::Socket::INET->new(Listen => 1, LocalAddr => "127.0.0.1") or exit 1; ' +
  'exit(IO::Socket::INET->new(PeerAddr => "127.0.0.1", PeerPort => $l->sockport) ? 0 : 1)';
const PERL_UNIX = 'my $p = "$ENV{TMPDIR}/probe.sock"; unlink $p; ' +
  "my $l = IO::Socket::UNIX->new(Local => $p, Listen => 1) or exit 1; " +
  "exit(IO::Socket::UNIX->new(Peer => $p) ? 0 : 1)";

export const PROBE_SH = `#!/bin/sh
echo "probe started"
perl_ok() { perl -MIO::Socket::INET -MIO::Socket::UNIX -e 1 2>/dev/null; }
up_interfaces() { for i in /sys/class/net/*; do
  f=$(cat "$i/flags" 2>/dev/null) && [ $((f & 1)) -eq 1 ] && printf '%s ' "\${i##*/}"; done; }
folder() { if [ "$1" = TMPDIR ]; then echo "$TMPDIR"; else echo "$1"; fi; }
for word in "$@"; do
  kind=\${word%%=*}; target=\${word#*=}; r=fail
  case $kind in
    read) if v=$(tr -d '\\n' < "$target" 2>/dev/null); then r="ok $v"; fi ;;
    list) ls "$target" >/dev/null 2>&1 && r=ok ;;
    env) env | grep -q -- "$target" && r=ok ;;
    connect) if ! perl_ok; then r=no-perl
      elif perl -MIO::Socket::INET -e '${PERL_CONNECT}' "$target" 2>/dev/null; then r=ok; fi ;;
    rewrite) printf 'rewritten\\n' > "$(folder "$target")/hello.txt" 2>/dev/null && r=ok ;;
    dotgit) d=$(folder "$target")/.git
      mkdir "$d" 2>/dev/null && printf '[core]\\n' > "$d/config" 2>/dev/null && r=ok ;;
    plantlink) ln -s /etc/hosts "$(folder "$target")/planted-link" 2>/dev/null && r=ok ;;
    grep) r=$(grep -rl -- "$target" . 2>/dev/null | sort | tr '\\n' ' '); r=\${r:-none} ;;
    ifaces) r=$(up_interfaces); r=\${r:-none} ;;
    lookup) r=$(./lookup "$target" 2>/dev/null) || r="fail $?" ;;
    job) launchctl submit -l "$target" -- /usr/bin/true 2>/dev/null &&
      launchctl list "$target" >/dev/null 2>&1 && r=ok ;;
    loopback) if ! perl_ok; then r=no-perl
      elif [ "$target" = tcp ]; then perl -MIO::Socket::INET -e '${PERL_TCP}' 2>/dev/null && r=ok
      else perl -MIO::Socket::UNIX -e '${PERL_UNIX}' 2>/dev/null && r=ok; fi ;;
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
