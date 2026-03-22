export class AuthCodeGenerator {
  private readonly characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  generateAuthCode(): string {
    let code = "";
    for (let i = 0; i < 6; i++) {
      const randomIndex = Math.floor(Math.random() * this.characters.length);
      code += this.characters[randomIndex];
    }
    return code;
  }

  isValidAuthCode(code: string): boolean {
    return /^[A-Z0-9]{6}$/.test(code);
  }
}
