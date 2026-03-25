import { assertEquals, assertRejects } from "jsr:@std/assert";
import { StartupCoordinator, StartupError } from "./mod.ts";
import type { Target } from "@dto/target.ts";

const VALID_TARGET: Target = {
  host: "https://api.example.com",
  route: ["v1", "audio"],
  method: "POST",
  headers: { "Content-Type": "application/json" },
  query: {},
  concurrency: 2,
  timeoutMs: 30000,
  retries: 3,
};

function makeTargets(...names: string[]): Map<string, Target> {
  const map = new Map<string, Target>();
  for (const name of names) {
    map.set(name, { ...VALID_TARGET });
  }
  return map;
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const targets = makeTargets("fetch-audio", "summarize");
  return {
    targetLoader: {
      load: () => Promise.resolve(targets),
    },
    redisConnection: {
      connect: () => Promise.resolve(),
      ping: () => Promise.resolve(true),
      getVersion: () => Promise.resolve("7.0.12"),
      getMaxMemory: () => Promise.resolve("256mb"),
    },
    onReady: (_targets: Map<string, Target>) => {},
    ...overrides,
  };
}

Deno.test("StartupCoordinator - success path returns loaded targets", async () => {
  const deps = makeDeps();
  const coordinator = new StartupCoordinator(deps);

  const result = await coordinator.start();

  assertEquals(result.size, 2);
  assertEquals(result.has("fetch-audio"), true);
  assertEquals(result.has("summarize"), true);
});

Deno.test("StartupCoordinator - calls onReady with targets on success", async () => {
  let readyTargets: Map<string, Target> | null = null;
  const deps = makeDeps({
    onReady: (targets: Map<string, Target>) => {
      readyTargets = targets;
    },
  });
  const coordinator = new StartupCoordinator(deps);

  await coordinator.start();

  assertEquals(readyTargets !== null, true);
  assertEquals(readyTargets!.size, 2);
});

Deno.test("StartupCoordinator - throws StartupError when target loading fails", async () => {
  const deps = makeDeps({
    targetLoader: {
      load: () => Promise.reject(new Error("no target files found")),
    },
  });
  const coordinator = new StartupCoordinator(deps);

  const err = await assertRejects(
    () => coordinator.start(),
    StartupError,
  );
  assertEquals(err.message.includes("no target files found"), true);
});

Deno.test("StartupCoordinator - throws StartupError when Redis connect fails", async () => {
  const deps = makeDeps({
    redisConnection: {
      connect: () => Promise.reject(new Error("ECONNREFUSED")),
      ping: () => Promise.resolve(true),
      getVersion: () => Promise.resolve("7.0.12"),
      getMaxMemory: () => Promise.resolve("256mb"),
    },
  });
  const coordinator = new StartupCoordinator(deps);

  const err = await assertRejects(
    () => coordinator.start(),
    StartupError,
  );
  assertEquals(err.message.includes("ECONNREFUSED"), true);
});

Deno.test("StartupCoordinator - throws StartupError when Redis ping returns false", async () => {
  const deps = makeDeps({
    redisConnection: {
      connect: () => Promise.resolve(),
      ping: () => Promise.resolve(false),
      getVersion: () => Promise.resolve("7.0.12"),
      getMaxMemory: () => Promise.resolve("256mb"),
    },
  });
  const coordinator = new StartupCoordinator(deps);

  const err = await assertRejects(
    () => coordinator.start(),
    StartupError,
  );
  assertEquals(err.message.includes("ping"), true);
});

Deno.test("StartupCoordinator - throws StartupError when Redis version < 5", async () => {
  const deps = makeDeps({
    redisConnection: {
      connect: () => Promise.resolve(),
      ping: () => Promise.resolve(true),
      getVersion: () => Promise.resolve("4.0.14"),
      getMaxMemory: () => Promise.resolve("256mb"),
    },
  });
  const coordinator = new StartupCoordinator(deps);

  const err = await assertRejects(
    () => coordinator.start(),
    StartupError,
  );
  assertEquals(err.message.includes("BullMQ requires Redis >= 5.0"), true);
});

Deno.test("StartupCoordinator - logs warning when maxmemory is null but does not throw", async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => warnings.push(msg);

  try {
    const deps = makeDeps({
      redisConnection: {
        connect: () => Promise.resolve(),
        ping: () => Promise.resolve(true),
        getVersion: () => Promise.resolve("7.0.12"),
        getMaxMemory: () => Promise.resolve(null),
      },
    });
    const coordinator = new StartupCoordinator(deps);

    const result = await coordinator.start();

    assertEquals(result.size, 2);
    assertEquals(warnings.length > 0, true);
    assertEquals(warnings.some((w) => w.includes("maxmemory")), true);
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test("StartupCoordinator - Redis version 5.0.0 passes (boundary)", async () => {
  const deps = makeDeps({
    redisConnection: {
      connect: () => Promise.resolve(),
      ping: () => Promise.resolve(true),
      getVersion: () => Promise.resolve("5.0.0"),
      getMaxMemory: () => Promise.resolve("256mb"),
    },
  });
  const coordinator = new StartupCoordinator(deps);

  const result = await coordinator.start();

  assertEquals(result.size, 2);
});
