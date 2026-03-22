export const EXIT = {
  OK: 0,
  GENERAL: 1,
  USAGE: 2,
  CONNECTION: 3,
  TIMEOUT: 4,
  BLOCKED: 5,
} as const;

export class CliError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
  }
}
