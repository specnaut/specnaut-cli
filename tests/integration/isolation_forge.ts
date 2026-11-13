/**
 * A stand-in for the forge: a listener on the host's loopback that counts the connections it
 * accepts. It runs as a perl process of its own, since the tests run without network permission.
 */

export type Forge = {
  /** `127.0.0.1:<port>`. */
  readonly address: string;
  readonly accepted: () => number;
  /** Resolves once `count` connections were accepted, or rejects past `ms`. */
  readonly reached: (count: number, ms?: number) => Promise<void>;
  readonly close: () => Promise<void>;
};

const LISTEN = "use IO::Socket::INET; $| = 1; my $l = IO::Socket::INET->new(Listen => 5, " +
  'LocalAddr => "127.0.0.1", ReuseAddr => 1) or die "listen: $!"; print $l->sockport, "\\n"; ' +
  'while (my $c = $l->accept) { print "accepted\\n"; close $c }';

export async function openForge(): Promise<Forge> {
  const child = new Deno.Command("/usr/bin/perl", {
    args: ["-e", LISTEN],
    stdin: "null",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const lines = linesOf(child.stdout.pipeThrough(new TextDecoderStream()));
  const first = await lines.next();
  if (first.done || !/^\d+$/.test(first.value)) {
    child.kill("SIGKILL");
    await child.status;
    throw new Error(`the forge stand-in did not listen: ${first.value}`);
  }
  return counted(child, first.value, lines);
}

/** The listener on `port`, counting each `accepted` line it prints until it is closed. */
function counted(child: Deno.ChildProcess, port: string, lines: AsyncGenerator<string>): Forge {
  let accepted = 0;
  const counting = (async () => {
    for await (const _ of lines) accepted++;
  })();
  return {
    address: `127.0.0.1:${port}`,
    accepted: () => accepted,
    reached: async (count, ms = 5_000) => {
      for (const until = Date.now() + ms; accepted < count; await later(50)) {
        if (Date.now() > until) throw new Error(`${accepted} connection(s), not ${count}`);
      }
    },
    close: async () => {
      child.kill("SIGKILL");
      await child.status;
      await counting;
    },
  };
}

function later(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
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
