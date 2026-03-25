import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TargetLoader } from "./mod.ts";

const VALID_TARGET = {
  host: "https://api.example.com",
  route: ["v1", "audio"],
  method: "POST",
  headers: { "Content-Type": "application/json" },
  query: {},
  concurrency: 2,
  timeoutMs: 30000,
  retries: 3,
};

Deno.test("TargetLoader - loads valid target files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/fetch-audio.json`,
      JSON.stringify(VALID_TARGET),
    );

    const loader = new TargetLoader({ targetsDir: dir });
    const targets = await loader.load();

    assertEquals(targets.size, 1);
    assertEquals(targets.has("fetch-audio"), true);
    assertEquals(targets.get("fetch-audio"), VALID_TARGET);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TargetLoader - throws descriptive error when directory does not exist", async () => {
  const dir = "/tmp/nonexistent-arachne-dir-" + crypto.randomUUID();
  const loader = new TargetLoader({ targetsDir: dir });

  await assertRejects(
    () => loader.load(),
    Error,
    `targets directory not found: ${dir}`,
  );
});

Deno.test("TargetLoader - throws when directory is empty", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const loader = new TargetLoader({ targetsDir: dir });

    await assertRejects(
      () => loader.load(),
      Error,
      `no target files found in ${dir}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TargetLoader - throws on invalid JSON with filename", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/bad-target.json`, "not valid json{{{");

    const loader = new TargetLoader({ targetsDir: dir });

    await assertRejects(
      () => loader.load(),
      Error,
      "bad-target.json",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TargetLoader - throws on Zod validation failure with filename and errors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const invalidTarget = { host: "not-a-url", route: "should-be-array" };
    await Deno.writeTextFile(
      `${dir}/broken.json`,
      JSON.stringify(invalidTarget),
    );

    const loader = new TargetLoader({ targetsDir: dir });

    await assertRejects(
      () => loader.load(),
      Error,
      "broken.json",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TargetLoader - loads multiple target files with correct names", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const secondTarget = {
      ...VALID_TARGET,
      host: "https://api2.example.com",
      method: "GET" as const,
    };

    await Deno.writeTextFile(
      `${dir}/fetch-audio.json`,
      JSON.stringify(VALID_TARGET),
    );
    await Deno.writeTextFile(
      `${dir}/send-notification.json`,
      JSON.stringify(secondTarget),
    );

    const loader = new TargetLoader({ targetsDir: dir });
    const targets = await loader.load();

    assertEquals(targets.size, 2);
    assertEquals(targets.get("fetch-audio"), VALID_TARGET);
    assertEquals(targets.get("send-notification"), secondTarget);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TargetLoader - ignores non-json files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/fetch-audio.json`,
      JSON.stringify(VALID_TARGET),
    );
    await Deno.writeTextFile(`${dir}/readme.txt`, "not a target");

    const loader = new TargetLoader({ targetsDir: dir });
    const targets = await loader.load();

    assertEquals(targets.size, 1);
    assertEquals(targets.has("fetch-audio"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
