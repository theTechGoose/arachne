export function generateAuthCode(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters[randomIndex];
  }

  return code;
}

export function isValidAuthCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}
