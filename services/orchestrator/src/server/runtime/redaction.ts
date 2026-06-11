const TOKEN_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/g,
  /\b(Api-Token\s+)[A-Za-z0-9._-]{8,}\b/gi,
];

export function redactText(text: string, redactionValues: readonly string[] = []): string {
  try {
    let redacted = text;
    for (const value of redactionValues) {
      if (!value) continue;
      redacted = redacted.split(value).join("[REDACTED]");
    }
    for (const pattern of TOKEN_PATTERNS) {
      redacted = redacted.replace(pattern, (_match, prefix) => {
        return typeof prefix === "string" && prefix.startsWith("Api-Token")
          ? `${prefix}[REDACTED]`
          : "[REDACTED]";
      });
    }
    return redacted;
  } catch {
    return "[REDACTION_FAILED]";
  }
}

export function redactJsonValue(value: unknown, redactionValues: readonly string[] = []): unknown {
  try {
    if (typeof value === "string") return redactText(value, redactionValues);
    if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, redactionValues));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          redactJsonValue(child, redactionValues),
        ]),
      );
    }
    return value;
  } catch {
    return "[REDACTION_FAILED]";
  }
}
