import { BaseValidator } from "../../base/mod.ts";

export class RecordingValidator extends BaseValidator {
  type = "recording";
  validate(): void {
    const requiredKeys = ["provider", "recordingId"];
    const isValid = requiredKeys.every((key) => key in this.data);
    if (isValid) return;
    throw new Error(
      `Validation failed: missing required keys. Required keys are: ${
        requiredKeys.join(", ")
      }`,
    );
  }
}
