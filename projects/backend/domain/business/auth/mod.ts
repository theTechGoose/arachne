export class Auth {
  async hashPassword(password: string): Promise<string> {
    const encoded = new TextEncoder().encode(password);
    const buffer = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return (await this.hashPassword(password)) === hash;
  }

  parseBasicAuth(
    header: string,
  ): { username: string; password: string } | null {
    if (!header.startsWith("Basic ")) return null;
    let decoded: string;
    try {
      decoded = atob(header.slice(6));
    } catch {
      return null;
    }
    const colon = decoded.indexOf(":");
    if (colon < 1) return null;
    return {
      username: decoded.slice(0, colon),
      password: decoded.slice(colon + 1),
    };
  }
}
