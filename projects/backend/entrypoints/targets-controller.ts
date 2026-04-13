import {
  TargetManager,
  TargetNotFoundError,
  TargetAlreadyExistsError,
  TargetValidationError,
} from "@domain/coordinators/target-manager/mod.ts";

type TargetsControllerDeps = {
  targetManager: TargetManager;
  onMutate: () => void;
};

export class TargetsController {
  #targetManager: TargetsControllerDeps["targetManager"];
  #onMutate: TargetsControllerDeps["onMutate"];

  constructor(deps: TargetsControllerDeps) {
    this.#targetManager = deps.targetManager;
    this.#onMutate = deps.onMutate;
  }

  async list(_req: Request): Promise<Response> {
    const targets = await this.#targetManager.list();
    return Response.json(targets);
  }

  async getOne(_req: Request, name: string): Promise<Response> {
    try {
      const target = await this.#targetManager.get(name);
      return Response.json(target);
    } catch (err) {
      if (err instanceof TargetNotFoundError) {
        return this.#error(err.message, 404);
      }
      throw err;
    }
  }

  async create(req: Request, name: string): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return this.#error("Invalid JSON", 400);
    }

    try {
      const target = await this.#targetManager.create(name, body);
      const response = Response.json(target, { status: 201 });
      this.#onMutate();
      return response;
    } catch (err) {
      if (err instanceof TargetAlreadyExistsError) {
        return this.#error(err.message, 409);
      }
      if (err instanceof TargetValidationError) {
        return this.#error(err.message, 422);
      }
      throw err;
    }
  }

  async update(req: Request, name: string): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return this.#error("Invalid JSON", 400);
    }

    try {
      const target = await this.#targetManager.update(name, body);
      const response = Response.json(target);
      this.#onMutate();
      return response;
    } catch (err) {
      if (err instanceof TargetNotFoundError) {
        return this.#error(err.message, 404);
      }
      if (err instanceof TargetValidationError) {
        return this.#error(err.message, 422);
      }
      throw err;
    }
  }

  async patch(req: Request, name: string): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return this.#error("Invalid JSON", 400);
    }

    try {
      const target = await this.#targetManager.patch(name, body);
      const response = Response.json(target);
      this.#onMutate();
      return response;
    } catch (err) {
      if (err instanceof TargetNotFoundError) {
        return this.#error(err.message, 404);
      }
      if (err instanceof TargetValidationError) {
        return this.#error(err.message, 422);
      }
      throw err;
    }
  }

  async delete(_req: Request, name: string): Promise<Response> {
    try {
      await this.#targetManager.delete(name);
      const response = new Response(null, { status: 204 });
      this.#onMutate();
      return response;
    } catch (err) {
      if (err instanceof TargetNotFoundError) {
        return this.#error(err.message, 404);
      }
      throw err;
    }
  }

  #error(message: string, status: number): Response {
    return Response.json({ error: message }, { status });
  }
}
