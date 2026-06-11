/** Tiny classNames joiner (avoids a clsx dependency). */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
