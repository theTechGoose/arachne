export function parse(filepath: string): Record<string, string> {
  const segments = filepath.split("/").filter(Boolean);

  // Drop the last segment (filename)
  segments.pop();

  const result: Record<string, string> = {};

  for (const segment of segments) {
    const eq = segment.indexOf("=");

    // Skip anything that doesn't fit key=value
    if (eq === -1 || eq === 0 || eq === segment.length - 1) continue;

    const key = segment.slice(0, eq);
    const value = segment.slice(eq + 1);

    // First occurrence wins — skip duplicates
    if (key in result) continue;

    result[key] = value;
  }

  return result;
}
