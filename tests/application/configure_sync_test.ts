import { assertEquals } from "@std/assert";
import { ConfigureSyncUseCase } from "../../src/application/configure_sync.ts";
import type {
  ConfigStore,
  InteractivePrompt,
  SubprocessRunner,
} from "../../src/application/ports.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";

function fakePrompt(answers: Record<string, string>): InteractivePrompt {
  return {
    select: (message, choices) => {
      const key = Object.keys(answers).find((k) => message.includes(k));
      const chosen = key ? answers[key] : choices[0].value;
      return Promise.resolve(chosen);
    },
    confirm: (message) => {
      const key = Object.keys(answers).find((k) => message.includes(k));
      return Promise.resolve(key ? answers[key] === "yes" : false);
    },
    text: (message, def) => {
      const key = Object.keys(answers).find((k) => message.includes(k));
      return Promise.resolve(key ? answers[key] : def ?? "");
    },
  };
}

function fakeStore(): ConfigStore & { getWritten: () => SyncConfig | undefined } {
  let written: SyncConfig | undefined;
  return {
    read: () => Promise.resolve(null),
    write: (_d, c) => {
      written = c;
      return Promise.resolve();
    },
    configPath: (d) => `${d}/.specflow/config.yml`,
    getWritten: () => written,
  };
}

function fakeProjects(runner: "none" | "one" | "many"): SubprocessRunner {
  return {
    run: (_cmd, args) => {
      if (args[0] === "--version") {
        return Promise.resolve({ code: 0, stdout: "gh 2", stderr: "" });
      }
      if (args.includes("auth") && args.includes("status")) {
        return Promise.resolve({ code: 0, stdout: "authed", stderr: "" });
      }
      if (args.includes("graphql")) {
        const projects = runner === "none"
          ? []
          : runner === "one"
          ? [{ id: "P1", number: 3, title: "MyProj" }]
          : [
            { id: "P1", number: 1, title: "Alpha" },
            { id: "P2", number: 2, title: "Beta" },
          ];
        // First call returns projects list; subsequent (fields) returns empty.
        const queryArg = args[args.indexOf("-f") + 1] ?? "";
        if (queryArg.includes("viewer")) {
          return Promise.resolve({
            code: 0,
            stdout: JSON.stringify({
              data: { viewer: { projectsV2: { nodes: projects } } },
            }),
            stderr: "",
          });
        }
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({
            data: {
              node: {
                fields: {
                  nodes: [
                    { id: "F_status", name: "Status", dataType: "SINGLE_SELECT" },
                    { id: "F_priority", name: "Priority", dataType: "NUMBER" },
                    { id: "F_complexity", name: "Complexity", dataType: "NUMBER" },
                  ],
                },
              },
            },
          }),
          stderr: "",
        });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
  };
}

Deno.test("ConfigureSyncUseCase writes a config with no project when user picks 'none'", async () => {
  const store = fakeStore();
  const prompt = fakePrompt({ "Which project": "__none__" });
  const uc = new ConfigureSyncUseCase({
    store,
    prompt,
    runner: fakeProjects("one"),
  });
  const cfg = await uc.execute({
    projectDir: "/p",
    repoHint: "kevin/specflow",
  });
  assertEquals(cfg.sync.project, null);
  assertEquals(cfg.sync.repo, "kevin/specflow");
  assertEquals(store.getWritten()?.sync.provider, "github");
});

Deno.test("ConfigureSyncUseCase writes a config with selected project", async () => {
  const store = fakeStore();
  const prompt = fakePrompt({ "Which project": "3", "Status field": "Status" });
  const uc = new ConfigureSyncUseCase({
    store,
    prompt,
    runner: fakeProjects("one"),
  });
  const cfg = await uc.execute({
    projectDir: "/p",
    repoHint: "kevin/specflow",
  });
  assertEquals(cfg.sync.project?.number, 3);
});

Deno.test("ConfigureSyncUseCase fails fast when gh unavailable", async () => {
  const store = fakeStore();
  const prompt = fakePrompt({});
  const runner: SubprocessRunner = {
    run: () => Promise.resolve({ code: 127, stdout: "", stderr: "not found" }),
  };
  const uc = new ConfigureSyncUseCase({ store, prompt, runner });
  let threw = false;
  try {
    await uc.execute({ projectDir: "/p", repoHint: "k/s" });
  } catch (err) {
    threw = true;
    if (err instanceof Error) {
      assertEquals(err.message.includes("gh CLI"), true);
    }
  }
  assertEquals(threw, true);
});
