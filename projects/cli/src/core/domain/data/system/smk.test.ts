import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { SystemAdapter } from "./mod.ts";

const adapter = new SystemAdapter();

Deno.test("SystemAdapter exposes getMacSsid", () => { assertEquals(typeof adapter.getMacSsid, "function"); });
Deno.test("SystemAdapter exposes readPasswordStdin", () => { assertEquals(typeof adapter.readPasswordStdin, "function"); });
