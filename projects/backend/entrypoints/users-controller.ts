import type { CreateUserRequest, UpdateUserRequest } from "@dto/user.ts";
import {
  UserManager,
  UserNotFoundError,
  UserAlreadyExistsError,
} from "@domain/coordinators/user-manager/mod.ts";

type UsersControllerDeps = {
  userManager: UserManager;
};

export class UsersController {
  #userManager: UsersControllerDeps["userManager"];

  constructor(deps: UsersControllerDeps) {
    this.#userManager = deps.userManager;
  }

  async list(_req: Request): Promise<Response> {
    const users = await this.#userManager.list();
    return Response.json(users);
  }

  async create(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return this.#error("Invalid JSON", 400);
    }

    const parsed = body as Partial<CreateUserRequest>;
    if (
      !parsed.username ||
      typeof parsed.username !== "string" ||
      !parsed.password ||
      typeof parsed.password !== "string" ||
      !Array.isArray(parsed.permissions)
    ) {
      return this.#error("username, password, and permissions are required", 400);
    }

    const validPermissions = ["auth", "queue"];
    const invalidPerms = parsed.permissions.filter(
      (p) => !validPermissions.includes(p),
    );
    if (invalidPerms.length > 0) {
      return this.#error(
        `Invalid permissions: ${invalidPerms.join(", ")}`,
        400,
      );
    }

    try {
      const user = await this.#userManager.create(parsed as CreateUserRequest);
      return Response.json(user, { status: 201 });
    } catch (err) {
      if (err instanceof UserAlreadyExistsError) {
        return this.#error(err.message, 409);
      }
      throw err;
    }
  }

  async update(req: Request, username: string): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return this.#error("Invalid JSON", 400);
    }

    const parsed = body as Partial<UpdateUserRequest>;
    const update: UpdateUserRequest = {};

    if (parsed.password !== undefined) {
      if (typeof parsed.password !== "string") {
        return this.#error("password must be a string", 400);
      }
      update.password = parsed.password;
    }

    if (parsed.permissions !== undefined) {
      if (!Array.isArray(parsed.permissions)) {
        return this.#error("permissions must be an array", 400);
      }
      const validPermissions = ["auth", "queue"];
      const invalidPerms = parsed.permissions.filter(
        (p) => !validPermissions.includes(p),
      );
      if (invalidPerms.length > 0) {
        return this.#error(
          `Invalid permissions: ${invalidPerms.join(", ")}`,
          400,
        );
      }
      update.permissions = parsed.permissions;
    }

    if (parsed.status !== undefined) {
      if (parsed.status !== "active" && parsed.status !== "inactive") {
        return this.#error("status must be active or inactive", 400);
      }
      update.status = parsed.status;
    }

    try {
      const user = await this.#userManager.update(username, update);
      return Response.json(user);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return this.#error(err.message, 404);
      }
      throw err;
    }
  }

  async delete(_req: Request, username: string): Promise<Response> {
    try {
      await this.#userManager.delete(username);
      return new Response(null, { status: 204 });
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return this.#error(err.message, 404);
      }
      throw err;
    }
  }

  #error(message: string, status: number): Response {
    return Response.json({ error: message }, { status });
  }
}
