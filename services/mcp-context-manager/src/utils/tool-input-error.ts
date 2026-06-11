/**
 * Thrown when a tool receives a malformed input (bad glob, invalid regex, etc.).
 * Maps to HTTP 400 with code "INVALID_PARAMS".
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
