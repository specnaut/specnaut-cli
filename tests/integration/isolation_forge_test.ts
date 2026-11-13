import { assertEquals } from "@std/assert";
import { NO_PERL } from "../infrastructure/sandbox_live_fixture.ts";
import { openForge } from "./isolation_forge.ts";

/**
 * The forge stand-in's count is read with no wait: every connection made before `settled()` is
 * asked is in the count it answers, however late its line would have reached us otherwise.
 */

const CONNECT = "use IO::Socket::INET; " +
  'IO::Socket::INET->new(PeerAddr => $ARGV[0]) or die "connect: $!" for 1 .. $ARGV[1]';

/** `times` connections to `address`, from a process of their own: the tests hold no network. */
async function connect(address: string, times: number): Promise<void> {
  const args = ["-e", CONNECT, address, `${times}`];
  const { code } = await new Deno.Command("/usr/bin/perl", { args, stdout: "null" }).output();
  assertEquals(code, 0, `connecting to ${address} failed`);
}

Deno.test({
  name: "isolation forge: the count includes every connection made before it is asked",
  ignore: NO_PERL !== null,
  fn: async () => {
    const forge = await openForge();
    try {
      assertEquals(await forge.settled(), 0);
      await connect(forge.address, 2);
      assertEquals(await forge.settled(), 2);
      // Held still, the stand-in accepts nothing: the connections wait in its queue, unprinted.
      Deno.kill(forge.pid, "SIGSTOP");
      try {
        await connect(forge.address, 3);
      } finally {
        Deno.kill(forge.pid, "SIGCONT");
      }
      assertEquals(await forge.settled(), 5);
    } finally {
      await forge.close();
    }
  },
});
