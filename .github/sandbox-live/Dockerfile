# Not built. The image ci.yml's sandbox-linux job runs the live container tests in, named here
# so Dependabot moves its digest. A run never pulls (--pull never), so CI pulls it first. The
# probe (tests/integration/isolation_branch.ts) needs /bin/sh, coreutils at merged-/usr paths,
# and /usr/bin/perl with IO::Socket::INET, IO::Socket::UNIX and POSIX (Debian's perl-base).
FROM docker.io/library/debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
