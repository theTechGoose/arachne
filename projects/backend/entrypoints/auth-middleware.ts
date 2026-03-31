import type { MiddlewareHandler } from "#hono";
import type { Permission } from "@dto/user.ts";

type AuthLike = {
  parseBasicAuth(
    header: string,
  ): { username: string; password: string } | null;
};

type UserManagerLike = {
  authenticate(
    username: string,
    password: string,
  ): Promise<{
    permission: (p: Permission) => boolean;
  } | null>;
  count(): Promise<number>;
};

export function requireAuth(
  userManager: UserManagerLike,
  auth: AuthLike,
  permission?: Permission,
): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("Authorization");

    if (!header) {
      return c.json(
        { error: "Unauthorized" },
        401,
        { "WWW-Authenticate": 'Basic realm="Arachne"' },
      );
    }

    const creds = auth.parseBasicAuth(header);
    if (!creds) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const result = await userManager.authenticate(creds.username, creds.password);
    if (!result) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (permission && !result.permission(permission)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  };
}

export function requireAuthOrBootstrap(
  userManager: UserManagerLike,
  auth: AuthLike,
  permission?: Permission,
): MiddlewareHandler {
  return async (c, next) => {
    const total = await userManager.count();
    if (total === 0) {
      await next();
      return;
    }
    return requireAuth(userManager, auth, permission)(c, next);
  };
}
