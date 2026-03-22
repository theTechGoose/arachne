import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { httpLogger } from "./mod.ts";

Deno.test("httpLogger is a function", () => { assertEquals(typeof httpLogger, "function"); });
