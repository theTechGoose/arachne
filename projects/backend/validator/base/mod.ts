export abstract class BaseValidator {
  abstract type: string;
  constructor(protected data: Record<string, string>) {}
  protected pick(): boolean {
    return this.type === this.data?.type;
  }
  abstract validate(): void;
}
