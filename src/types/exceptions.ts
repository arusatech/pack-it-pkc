import type { DocumentConverter } from "./converter.js";

export class PackItPkcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackItPkcError";
  }
}

export class MissingDependencyError extends PackItPkcError {
  constructor(
    public readonly converter: string,
    public readonly feature: string,
  ) {
    super(
      `${converter} needs optional dependency [${feature}]. Install it to enable this format.`,
    );
    this.name = "MissingDependencyError";
  }
}

export class UnsupportedFormatError extends PackItPkcError {
  constructor(message = "No converter supports this file format.") {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

export interface FailedConversionAttempt {
  converter: DocumentConverter;
  error: unknown;
}

export class FileConversionError extends PackItPkcError {
  readonly attempts: FailedConversionAttempt[];

  constructor(attempts: FailedConversionAttempt[], message?: string) {
    const detail =
      message ??
      `File conversion failed after ${attempts.length} attempt(s):\n` +
        attempts
          .map(
            (a) =>
              ` - ${a.converter.constructor.name}: ${a.error instanceof Error ? a.error.message : String(a.error)}`,
          )
          .join("\n");
    super(detail);
    this.name = "FileConversionError";
    this.attempts = attempts;
  }
}
