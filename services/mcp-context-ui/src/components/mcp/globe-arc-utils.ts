/**
 * Globe Arc Utilities
 *
 * Pure functions for computing cross-globe arc bezier curves.
 * The intended behavior is to render arcs as bezier curves that bow
 * outward from the straight-line path between two globe surface points.
 *
 * Feature: 3d-codebase-globe-visualizer
 */

// ---------------------------------------------------------------------------
// Bezier Arc Computation
// ---------------------------------------------------------------------------

/**
 * Compute a quadratic bezier control point for a cross-globe arc.
 * The control point is the midpoint between source and target, elevated
 * by 20% of the inter-point distance along the Y axis (upward).
 *
 * This ensures the arc "bows" outward (above the straight-line path).
 */
export function computeBezierControlPoint(
  source: [number, number, number],
  target: [number, number, number],
): [number, number, number] {
  const midX = (source[0] + target[0]) / 2;
  const midY = (source[1] + target[1]) / 2;
  const midZ = (source[2] + target[2]) / 2;

  // Compute distance between source and target
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  const dz = target[2] - source[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Elevate the midpoint by 20% of the distance
  const elevation = distance * 0.2;

  return [midX, midY + elevation, midZ];
}

/**
 * Generate bezier arc points (source, control, target) for a cross-globe arc.
 * Returns an array of 3 control points suitable for a quadratic bezier curve.
 *
 * The midpoint is elevated above the straight-line path to create a visible arc.
 */
export function computeBezierArcPoints(
  source: [number, number, number],
  target: [number, number, number],
): [number, number, number][] {
  const control = computeBezierControlPoint(source, target);
  return [source, control, target];
}

/**
 * Check if a point is collinear with two endpoints (within tolerance).
 * Returns true if the point lies on the line between start and end.
 */
export function isCollinear(
  start: [number, number, number],
  point: [number, number, number],
  end: [number, number, number],
  tolerance: number = 1e-6,
): boolean {
  // Cross product of (point - start) and (end - start)
  const ax = point[0] - start[0];
  const ay = point[1] - start[1];
  const az = point[2] - start[2];
  const bx = end[0] - start[0];
  const by = end[1] - start[1];
  const bz = end[2] - start[2];

  const crossX = ay * bz - az * by;
  const crossY = az * bx - ax * bz;
  const crossZ = ax * by - ay * bx;

  const crossMagnitude = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
  return crossMagnitude < tolerance;
}
