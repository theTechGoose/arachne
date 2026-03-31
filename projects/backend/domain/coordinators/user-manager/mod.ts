import type {
  User,
  PublicUser,
  CreateUserRequest,
  UpdateUserRequest,
  Permission,
} from "@dto/user.ts";

type AuthLike = {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
};

type UserStoreLike = {
  create(user: User): Promise<void>;
  get(username: string): Promise<User | null>;
  update(
    username: string,
    fields: Partial<Pick<User, "passwordHash" | "permissions" | "status">>,
  ): Promise<boolean>;
  delete(username: string): Promise<boolean>;
  list(): Promise<User[]>;
  count(): Promise<number>;
};

type UserManagerDeps = {
  auth: AuthLike;
  userStore: UserStoreLike;
};

export class UserNotFoundError extends Error {
  constructor(username: string) {
    super(`User not found: ${username}`);
  }
}

export class UserAlreadyExistsError extends Error {
  constructor(username: string) {
    super(`User already exists: ${username}`);
  }
}

function toPublic(user: User): PublicUser {
  return {
    username: user.username,
    permissions: user.permissions,
    status: user.status,
  };
}

export class UserManager {
  #auth: AuthLike;
  #userStore: UserStoreLike;

  constructor(deps: UserManagerDeps) {
    this.#auth = deps.auth;
    this.#userStore = deps.userStore;
  }

  async create(req: CreateUserRequest): Promise<PublicUser> {
    const existing = await this.#userStore.get(req.username);
    if (existing) throw new UserAlreadyExistsError(req.username);
    const passwordHash = await this.#auth.hashPassword(req.password);
    const user: User = {
      username: req.username,
      passwordHash,
      permissions: req.permissions,
      status: "active",
    };
    await this.#userStore.create(user);
    return toPublic(user);
  }

  async get(username: string): Promise<PublicUser> {
    const user = await this.#userStore.get(username);
    if (!user) throw new UserNotFoundError(username);
    return toPublic(user);
  }

  async update(
    username: string,
    req: UpdateUserRequest,
  ): Promise<PublicUser> {
    const user = await this.#userStore.get(username);
    if (!user) throw new UserNotFoundError(username);
    const fields: Partial<Pick<User, "passwordHash" | "permissions" | "status">> = {};
    if (req.password !== undefined) {
      fields.passwordHash = await this.#auth.hashPassword(req.password);
    }
    if (req.permissions !== undefined) fields.permissions = req.permissions;
    if (req.status !== undefined) fields.status = req.status;
    await this.#userStore.update(username, fields);
    return toPublic({ ...user, ...fields, username });
  }

  async delete(username: string): Promise<void> {
    const deleted = await this.#userStore.delete(username);
    if (!deleted) throw new UserNotFoundError(username);
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.#userStore.list();
    return users.map(toPublic);
  }

  async authenticate(
    username: string,
    password: string,
  ): Promise<{ user: User; permission: (p: Permission) => boolean } | null> {
    const user = await this.#userStore.get(username);
    if (!user || user.status !== "active") return null;
    const valid = await this.#auth.verifyPassword(password, user.passwordHash);
    if (!valid) return null;
    return {
      user,
      permission: (p) => user.permissions.includes(p),
    };
  }

  async count(): Promise<number> {
    return this.#userStore.count();
  }
}
