import { TargetSchema, type Target } from "@dto/target.ts";
import { ZodError } from "#zod";

type TargetStoreLike = {
  create(name: string, target: Target): Promise<void>;
  get(name: string): Promise<Target | null>;
  update(name: string, target: Target): Promise<boolean>;
  delete(name: string): Promise<boolean>;
  load(): Promise<Map<string, Target>>;
};

type TargetManagerDeps = {
  targetStore: TargetStoreLike;
};

export class TargetNotFoundError extends Error {
  constructor(name: string) {
    super(`Target not found: ${name}`);
  }
}

export class TargetAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`Target already exists: ${name}`);
  }
}

export class TargetValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class TargetManager {
  #targetStore: TargetStoreLike;

  constructor(deps: TargetManagerDeps) {
    this.#targetStore = deps.targetStore;
  }

  async list(): Promise<Array<{ name: string } & Target>> {
    const targets = await this.#targetStore.load();
    return [...targets.entries()].map(([name, target]) => ({
      name,
      ...target,
    }));
  }

  async get(name: string): Promise<Target> {
    const target = await this.#targetStore.get(name);
    if (!target) throw new TargetNotFoundError(name);
    return target;
  }

  async create(name: string, body: unknown): Promise<Target> {
    const existing = await this.#targetStore.get(name);
    if (existing) throw new TargetAlreadyExistsError(name);
    const target = this.#validate(body);
    await this.#targetStore.create(name, target);
    return target;
  }

  async update(name: string, body: unknown): Promise<Target> {
    const target = this.#validate(body);
    const updated = await this.#targetStore.update(name, target);
    if (!updated) throw new TargetNotFoundError(name);
    return target;
  }

  async delete(name: string): Promise<void> {
    const deleted = await this.#targetStore.delete(name);
    if (!deleted) throw new TargetNotFoundError(name);
  }

  #validate(body: unknown): Target {
    try {
      return TargetSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", ");
        throw new TargetValidationError(`Invalid target: ${issues}`);
      }
      throw err;
    }
  }
}
