export const PARTIAL_NUMBERING_PATTERN = /^\.\d+$/;

/** Merge MasterFormat-style partial numbering (e.g. ".1") with the following line. */
export function mergePartialNumberingLines(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();

    if (PARTIAL_NUMBERING_PATTERN.test(stripped)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;

      if (j < lines.length) {
        result.push(`${stripped} ${lines[j].trim()}`);
        i = j + 1;
      } else {
        result.push(line);
        i++;
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}
