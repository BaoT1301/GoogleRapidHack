/**
 * Color Utility Functions
 *
 * WCAG-compliant color validation and contrast computation utilities.
 * Used by cluster color property tests and potentially by production
 * components for accessibility validation.
 *
 * Feature: 3d-codebase-globe-visualizer
 * Sprint: 7 — Property-Based Testing Batch 5 (Properties 56–60)
 */

/**
 * Validates that a string is a valid 6-digit hex color (e.g., "#4A90E2").
 */
export function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Converts a hex color string to RGB components (0–255).
 * Throws if the input is not a valid hex color.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (!isValidHexColor(hex)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

/**
 * Computes WCAG 2.1 relative luminance from a hex color.
 * Formula: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * Returns a value in [0, 1] where 0 = black, 1 = white.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);

  const linearize = (channel: number): number => {
    const sRGB = channel / 255;
    return sRGB <= 0.03928
      ? sRGB / 12.92
      : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  };

  const rLin = linearize(r);
  const gLin = linearize(g);
  const bLin = linearize(b);

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Computes WCAG 2.1 contrast ratio between two hex colors.
 * Formula: (L1 + 0.05) / (L2 + 0.05) where L1 >= L2.
 *
 * Returns a value in [1, 21] where 1 = no contrast, 21 = max contrast.
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const lum1 = relativeLuminance(hex1);
  const lum2 = relativeLuminance(hex2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns a lighter shade of the input hex color.
 * Amount is in [0, 1] where 0 = unchanged, 1 = white.
 */
export function lightenColor(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const clampedAmount = Math.max(0, Math.min(1, amount));

  const lighten = (channel: number): number =>
    Math.round(channel + (255 - channel) * clampedAmount);

  const newR = lighten(r);
  const newG = lighten(g);
  const newB = lighten(b);

  const toHex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
}
