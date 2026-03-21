import { Injectable, type AuthGuard, type ExecutionContext } from "@danet/core";
import { verify } from "@domain/business/auth-hmac/mod.ts";

@Injectable()
export class BasicAuthGuard implements AuthGuard {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const url = new URL(context.req.url);

    if (url.pathname.startsWith("/api")) return true;
    if (url.pathname.startsWith("/auth")) return true;

    const authHeader = context.req.raw.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) return false;

    try {
      const base64Credentials = authHeader.substring(6);
      const credentials = atob(base64Credentials);
      const [username, password] = credentials.split(":");

      if (!username || !password) return false;
      return this.validateCredentials(username, password);
    } catch {
      return false;
    }
  }

  private validateCredentials(username: string, password: string): boolean {
    if (this.isEmailFormat(username) && password.length === 10) {
      if (this.isEmailAllowed(username)) {
        return verify(username, password);
      }
    }

    let userIndex = 1;
    while (true) {
      const userEnv = Deno.env.get(`USER_${userIndex}`);
      if (!userEnv) break;

      const [envUsername, envPassword] = userEnv.split("::");
      if (envUsername === username && envPassword === password) return true;
      userIndex++;
    }

    return false;
  }

  private isEmailFormat(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private isEmailAllowed(email: string): boolean {
    const usersEnv = Deno.env.get("USERS");
    if (!usersEnv) return false;
    const allowedEmails = usersEnv.split(",").map((e) => e.trim().toLowerCase());
    return allowedEmails.includes(email.toLowerCase());
  }
}
