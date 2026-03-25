export class TextHelpers {
  stripCr(s: string): string {
    return s.replace(/\r/g, "");
  }
}
