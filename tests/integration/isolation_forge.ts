/**
 * A stand-in for the forge: a listener on the host's loopback that counts the connections it
 * accepts. It runs as a perl process of its own, since the tests run without network permission.
 *
 * Its count is read without a wait: asked on its input, it first accepts every connection waiting
 * in its queue, then answers. A connection made before the question is in the count, however
 * loaded the host, so no fixed delay stands between a run ending and its connections being seen.
 */

export type Forge = {
  /** `127.0.0.1:<port>`. */
  readonly address: string;
  /** The connections accepted so far, every one made before the call included. */
  readonly settled: () => Promise<number>;
  /** The listener's process, so a test can hold it still as a loaded host would. */
  readonly pid: number;
  readonly close: () => Promise<void>;
};

/** Each line on its input asks for `settled`, printed once the queue is drained; EOF ends it. */
const LISTEN = "use IO::Socket::INET; use IO::Select; $| = 1; " +
  "my $l = IO::Socket::INET->new(Listen => 5, " +
  'LocalAddr => "127.0.0.1", ReuseAddr => 1) or die "listen: $!"; $l->blocking(0); ' +
  'print $l->sockport, "\\n"; my $s = IO::Select->new($l, \\*STDIN); ' +
  "while (my @r = $s->can_read) { " +
  'while (my $c = $l->accept) { print "accepted\\n"; close $c } ' +
  "next unless grep { $_ != $l } @r; " +
  'sysread(STDIN, my $q, 4096) or exit; print "settled\\n" for $q =~ /\\n/g }';

const LISTENER: Deno.CommandOptions = {
  args: ["-e", LISTEN],
  stdin: "piped",
  stdout: "piped",
  stderr: "inherit",
};

export async function openForge(): Promise<Forge> {
  const child = new Deno.Command("/usr/bin/perl", LISTENER).spawn();
  const lines = linesOf(child.stdout.pipeThrough(new TextDecoderStream()));
  const first = await lines.next();
  if (first.done) {
    // It ended before listening: its exit code, and the reason it printed on our stderr, stand.
    await child.stdin.close();
    const { code } = await child.status;
    throw new Error(`the forge stand-in exited ${code} before it listened`);
  }
  if (!/^\d+$/.test(first.value)) {
    await child.stdin.close();
    await child.status;
    throw new Error(`the forge stand-in printed ${JSON.stringify(first.value)}, not its port`);
  }
  return counted(child, first.value, lines);
}

type Answer = { readonly ok: (n: number) => void; readonly fail: (e: Error) => void };

/** The listener on `port`; asking for its count writes a question on its input. */
function counted(child: Deno.ChildProcess, port: string, lines: AsyncGenerator<string>): Forge {
  const answers = tally(lines);
  const ask = child.stdin.getWriter();
  return {
    address: `127.0.0.1:${port}`,
    settled: async () => {
      const answer = answers.next();
      await ask.write(new TextEncoder().encode("settled?\n"));
      return await answer;
    },
    pid: child.pid,
    close: async () => {
      await ask.close();
      await child.status;
      await answers.done;
    },
  };
}

/** Counts each `accepted` line of `lines`, and answers each `settled` one with the count. */
function tally(lines: AsyncGenerator<string>) {
  let accepted = 0;
  const waiting: Answer[] = [];
  const done = (async () => {
    for await (const line of lines) {
      if (line === "settled") waiting.shift()?.ok(accepted);
      else accepted++;
    }
    for (const w of waiting.splice(0)) w.fail(new Error("the forge stand-in ended"));
  })();
  return { done, next: () => new Promise<number>((ok, fail) => waiting.push({ ok, fail })) };
}

/** The lines of `text`, as they arrive. */
async function* linesOf(text: ReadableStream<string>): AsyncGenerator<string> {
  let pending = "";
  for await (const chunk of text) {
    const parts = (pending + chunk).split("\n");
    pending = parts.pop()!;
    yield* parts;
  }
}
