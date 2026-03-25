import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";
import { CliError } from "../../../dto/exit-codes.ts";
import type { Target } from "../../../dto/config.ts";
import type { Conn } from "../../../dto/transport.ts";
import { DeployCoordinator } from "./mod.ts";
import type { DeployDeps } from "./mod.ts";

// --- helpers ---

function stubTarget(overrides?: Partial<Target>): Target {
  return {
    host: "https://example.com",
    route: ["/api"],
    method: "GET",
    headers: {},
    query: {},
    concurrency: 1,
    timeoutMs: 5000,
    retries: 0,
    ...overrides,
  };
}

const CONN: Conn = { host: "192.168.1.10", port: "22" };

function makeDeps(overrides?: Partial<DeployDeps>): DeployDeps {
  const calls: string[] = [];
  return {
    calls,
    loadTargets: overrides?.loadTargets ??
      (async (_pi: string) => {
        calls.push("loadTargets");
        return new Map([["site", stubTarget()]]);
      }),
    resolveSshConn: overrides?.resolveSshConn ??
      (async () => {
        calls.push("resolveSshConn");
        return CONN;
      }),
    copyDir: overrides?.copyDir ??
      (async (_conn: Conn, _localPath: string, _remotePath: string) => {
        calls.push(`copyDir`);
      }),
    sshExec: overrides?.sshExec ??
      (async (_conn: Conn, _cmd: string) => {
        calls.push("sshExec");
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }),
    log: overrides?.log ??
      ((_msg: string) => {
        calls.push("log");
      }),
    projectRoot: "/fake/root/",
    configDir: "/fake/root/config/",
    drainMs: overrides?.drainMs ?? 0,
    healthIntervalMs: overrides?.healthIntervalMs ?? 0,
    healthMaxAttempts: overrides?.healthMaxAttempts ?? 5,
  } as DeployDeps & { calls: string[] };
}

// --- test: validates targets before deploying ---

Deno.test("deploy coordinator - validates targets before deploying", async () => {
  const deps = makeDeps({
    loadTargets: async (_pi: string) => {
      throw new CliError(
        'Error: targets/ directory not found for "testpi".',
        1,
      );
    },
  });

  const coord = new DeployCoordinator(deps);
  await assertRejects(
    () => coord.run("testpi", { dryRun: false, fresh: false }),
    CliError,
    "targets/ directory not found",
  );
});

// --- test: dry-run prints plan without executing ---

Deno.test("deploy coordinator - dry-run shows plan without executing SSH", async () => {
  const logged: string[] = [];
  const deps = makeDeps({
    log: (msg: string) => {
      logged.push(msg);
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: true, fresh: false });

  // Should have loaded targets (validation)
  assertEquals((deps as DeployDeps & { calls: string[] }).calls.includes("loadTargets"), true);
  // Should NOT have called copyDir or sshExec
  assertEquals((deps as DeployDeps & { calls: string[] }).calls.includes("copyDir"), false);
  assertEquals((deps as DeployDeps & { calls: string[] }).calls.includes("sshExec"), false);
  // Should have logged something about the plan
  const hasPlan = logged.some((m) => m.toLowerCase().includes("plan") || m.toLowerCase().includes("dry"));
  assertEquals(hasPlan, true);
});

// --- test: fresh mode sends correct SSH commands ---

Deno.test("deploy coordinator - fresh mode sends drain and wipe commands", async () => {
  const sshCommands: string[] = [];
  const deps = makeDeps({
    sshExec: async (_conn: Conn, cmd: string) => {
      sshCommands.push(cmd);
      if (cmd.includes("curl")) {
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: true });

  // Should send SIGTERM to backend
  const hasSigterm = sshCommands.some((c) => c.includes("SIGTERM") || c.includes("kill"));
  assertEquals(hasSigterm, true);

  // Should stop services
  const hasStop = sshCommands.some((c) => c.includes("stop"));
  assertEquals(hasStop, true);

  // Should wipe app dirs but NOT redis
  const hasWipe = sshCommands.some((c) => c.includes("rm -rf") && c.includes("/opt/arachne/backend"));
  assertEquals(hasWipe, true);
  const hasRedisWipe = sshCommands.some((c) => c.includes("redis") && c.includes("rm"));
  assertEquals(hasRedisWipe, false);
});

// --- test: normal deploy performs 3 copy stages ---

Deno.test("deploy coordinator - normal deploy performs 3 copy stages", async () => {
  const copyPaths: string[] = [];
  const deps = makeDeps({
    copyDir: async (_conn: Conn, _localPath: string, remotePath: string) => {
      copyPaths.push(remotePath);
    },
    sshExec: async (_conn: Conn, cmd: string) => {
      if (cmd.includes("curl")) {
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: false });

  assertEquals(copyPaths.length, 3);
  assertEquals(copyPaths[0], "/opt/arachne/backend/");
  assertEquals(copyPaths[1], "/opt/arachne/ui/");
  assertEquals(copyPaths[2], "/opt/arachne/targets/");
});

// --- test: health check retries ---

Deno.test("deploy coordinator - health check retries on failure then succeeds", async () => {
  let healthAttempts = 0;
  const deps = makeDeps({
    sshExec: async (_conn: Conn, cmd: string) => {
      if (cmd.includes("curl") && cmd.includes("health")) {
        healthAttempts++;
        if (healthAttempts < 3) {
          return { ok: false, stdout: "", stderr: "connection refused", code: 1 };
        }
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: false });

  assertEquals(healthAttempts >= 3, true);
});
