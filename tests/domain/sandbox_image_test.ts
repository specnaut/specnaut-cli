import { assertEquals } from "@std/assert";
import { imageFromDevcontainer } from "../../src/domain/sandbox_image.ts";

/**
 * The container image a branch's gates run in comes from the base's devcontainer, and only its
 * digest-pinned `image:`. Every other field (mounts, run arguments, lifecycle commands, env,
 * features, build) would hand the sandbox a host path or run a host command: all are ignored.
 */

const DIGEST = `sha256:${"0123456789abcdef".repeat(4)}`;
const PINNED = `ghcr.io/acme/dev:1.2@${DIGEST}`;

Deno.test("imageFromDevcontainer: a digest-pinned image is taken", () => {
  assertEquals(imageFromDevcontainer({ image: PINNED }), { kind: "pinned", ref: PINNED });
  const port = `registry.example.com:5000/my-app/base@${DIGEST}`;
  assertEquals(imageFromDevcontainer({ image: port }), { kind: "pinned", ref: port });
});

Deno.test("imageFromDevcontainer: every field but the image is ignored", () => {
  const loaded = {
    image: PINNED,
    mounts: ["source=/,target=/host,type=bind"],
    runArgs: ["--privileged", "--network=host"],
    initializeCommand: "cat ~/.ssh/id_ed25519",
    postCreateCommand: "curl https://example.com",
    containerEnv: { TOKEN: "${localEnv:GH_TOKEN}" },
    remoteUser: "root",
    features: { "ghcr.io/acme/feature:1": {} },
    workspaceMount: "source=/,target=/w,type=bind",
  };
  assertEquals(imageFromDevcontainer(loaded), { kind: "pinned", ref: PINNED });
});

Deno.test("imageFromDevcontainer: a tag alone, or a digest of the wrong shape, is not pinned", () => {
  for (
    const image of [
      "ghcr.io/acme/dev:latest",
      "ghcr.io/acme/dev",
      `ghcr.io/acme/dev@sha256:${"a".repeat(63)}`,
      `ghcr.io/acme/dev@sha256:${"A".repeat(64)}`,
      `ghcr.io/acme/dev@sha512:${"a".repeat(64)}`,
      `ghcr.io/acme/dev@${DIGEST} `,
      `ghcr.io/acme/dev@${DIGEST}\n`,
    ]
  ) {
    assertEquals(imageFromDevcontainer({ image }).kind, "none", image);
  }
});

Deno.test("imageFromDevcontainer: a reference that would read as a flag is refused", () => {
  assertEquals(imageFromDevcontainer({ image: `--privileged@${DIGEST}` }).kind, "none");
  assertEquals(imageFromDevcontainer({ image: `-v/:/h@${DIGEST}` }).kind, "none");
});

Deno.test("imageFromDevcontainer: a build-only devcontainer, or none at all, names no image", () => {
  const build = { build: { dockerfile: "Dockerfile" }, runArgs: ["--privileged"] };
  assertEquals(imageFromDevcontainer(build), {
    kind: "none",
    why: "the devcontainer names no image",
  });
  assertEquals(imageFromDevcontainer(null), { kind: "none", why: "no devcontainer" });
  assertEquals(imageFromDevcontainer([PINNED]).kind, "none");
  assertEquals(imageFromDevcontainer({ image: 42 }).kind, "none");
});
