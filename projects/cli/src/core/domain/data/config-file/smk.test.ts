import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ConfigStore } from "./mod.ts";

const CLI_DIR = new URL("../../../../../", import.meta.url).pathname;
const store = new ConfigStore(CLI_DIR);

Deno.test("ConfigStore stores cliDir via constructor", () => {
  const config = store.loadConfig();
  assertEquals(typeof config, "object");
  assertEquals("pi" in config, true);
});

Deno.test("ConfigStore.loadConfig throws for bad path", () => {
  const bad = new ConfigStore("/nonexistent/");
  assertThrows(() => bad.loadConfig());
});

Deno.test("ConfigStore.readDotEnv reads .env", () => {
  const env = store.readDotEnv();
  assertEquals(env instanceof Map, true);
});

Deno.test("ConfigStore.readDotEnv throws for bad path", () => {
  const bad = new ConfigStore("/nonexistent/");
  assertThrows(() => bad.readDotEnv());
});
