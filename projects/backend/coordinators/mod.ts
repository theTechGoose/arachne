import { parse } from "../parser/mod.ts";
import { RecordingValidator } from "../validator/mod.ts";
import type { BaseValidator } from "../validator/base/mod.ts";

type ValidatorConstructor = new (data: Record<string, string>) => BaseValidator;

const VALIDATORS: Record<string, ValidatorConstructor> = {
  recording: RecordingValidator,
};

export class PathValidatorCoordinator {
  /**
   * Parses a raw file path, selects the appropriate validator based on
   * the `type` key, runs validation, and returns the parsed data.
   *
   * Throws if:
   *  - the path contains no `type` key
   *  - no validator is registered for the given type
   *  - validation fails (e.g. missing required keys)
   */
  validate(path: string): Record<string, string> {
    const data = parse(path);

    const type = data.type;
    if (!type) {
      throw new Error(`Path is missing required key: type`);
    }

    const Validator = VALIDATORS[type];
    if (!Validator) {
      throw new Error(`No validator registered for type: ${type}`);
    }

    const validator = new Validator(data);
    validator.validate();

    return data;
  }
}
