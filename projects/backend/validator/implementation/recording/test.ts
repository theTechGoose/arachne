import { assertEquals } from "jsr:@std/assert";
import { parse } from "../../../parser/mod.ts";
import { RecordingValidator } from "./mod.ts";

import one from "../../examples/one.json" with { type: "json" };
import two from "../../examples/two.json" with { type: "json" };
import three from "../../examples/three.json" with { type: "json" };

// Parse the file path into key=value pairs, then run the validator.
// validate() throws if required keys are missing, so we catch and return false.
function validate(path: string): boolean {
  try {
    const data = parse(path);
    const validator = new RecordingValidator(data);
    validator.validate();
    return true;
  } catch {
    return false;
  }
}

Deno.test("fails when recordingId is missing", () => {
  // /sftp/type=recording/provider=five9/whatever.mp3 — no recordingId
  const result = validate(one.value);
  assertEquals(result, one.expected);
});

Deno.test("passes when both provider and recordingId are present", () => {
  // /sftp/provider=five9/recordingId=abc123/whatever.mp3
  const result = validate(two.value);
  assertEquals(result, two.expected);
});

Deno.test("fails when provider is missing", () => {
  // /sftp/recordingId=abc123/type=recording/whatever.mp3 — no provider
  const result = validate(three.value);
  assertEquals(result, three.expected);
});
