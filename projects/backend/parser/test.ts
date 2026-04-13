import { assertEquals } from "jsr:@std/assert";
import { parse } from "./mod.ts";

import one from "./examples/one.json" with { type: "json" };
import two from "./examples/two.json" with { type: "json" };
import three from "./examples/three.json" with { type: "json" };

// Given a file path like /sftp/provider=five9/type=recording/call.mp3,
// parse() should extract each key=value segment into a plain object.

Deno.test("simple path with two key=value segments", () => {
  // /sftp/provider=five9/type=recording/whatever.mp3
  // should produce { provider: "five9", type: "recording" }
  const result = parse(one.value);
  assertEquals(result, one.expected);
});

Deno.test("deeper path with four key=value segments, including a hyphenated value", () => {
  // /sftp/provider=genie/type=voicemail/agentId=12345/date=2024-01-15/call.wav
  // should produce { provider: "genie", type: "voicemail", agentId: "12345", date: "2024-01-15" }
  const result = parse(two.value);
  assertEquals(result, two.expected);
});

Deno.test("duplicate key in path - first occurrence wins, second is ignored", () => {
  // /sftp/provider=five9/type=recording/provider=genie/whatever.mp3
  // provider appears twice - the first value (five9) should be kept
  const result = parse(three.value);
  assertEquals(result, three.expected);
});
