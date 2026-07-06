export interface StreamInfo {
  mimetype?: string | null;
  extension?: string | null;
  charset?: string | null;
  filename?: string | null;
  localPath?: string | null;
  url?: string | null;
}

export function copyAndUpdate(
  base: StreamInfo,
  ...updates: (StreamInfo | Partial<StreamInfo>)[]
): StreamInfo {
  const merged: StreamInfo = { ...base };
  for (const update of updates) {
    for (const [key, value] of Object.entries(update)) {
      if (value != null && value !== "") {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  return merged;
}

export function emptyStreamInfo(): StreamInfo {
  return {};
}
