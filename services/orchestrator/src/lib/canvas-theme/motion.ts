/**
 * Pure resolver from a {@link ThemePack}'s motion config + a node's effective
 * status to the Motion props the node renders with. Framework-free so it's
 * unit-testable without a DOM. Honors two kill-switches:
 *   • `pack.motion.enabled === false` → no animation (static node).
 *   • `reducedMotion === true` (from `useReducedMotion()` / prefers-reduced-motion)
 *     → no animation, so users who ask for less motion get a still node.
 *
 * Continuous, status-driven variants (e.g. a `running` pulse) are looked up via
 * `statuses[status].motionVariant` → `motion.perStatus[variant]` and merged over
 * the one-shot entrance target.
 */
import type { TargetAndTransition, Transition } from "motion/react";
import type { ThemePack, VisualStatus } from "./schema";

export interface NodeMotionProps {
  initial?: TargetAndTransition;
  animate?: TargetAndTransition;
  transition?: Transition;
  whileHover?: TargetAndTransition;
}

export function nodeMotionProps(
  pack: ThemePack,
  status: VisualStatus,
  opts: { reducedMotion?: boolean } = {},
): NodeMotionProps {
  const m = pack.motion;
  if (!m.enabled || opts.reducedMotion) return {};

  const variantName = pack.statuses[status]?.motionVariant;
  const variant = variantName ? m.perStatus?.[variantName] : undefined;

  const animate = {
    ...(m.entrance?.animate ?? {}),
    ...(variant?.animate ?? {}),
  } as TargetAndTransition;

  return {
    initial: m.entrance?.initial as TargetAndTransition | undefined,
    animate: Object.keys(animate).length > 0 ? animate : undefined,
    // A continuous status variant's transition (e.g. repeating) wins over the
    // one-shot entrance transition while that status is active.
    transition: (variant?.transition ?? m.entrance?.transition) as
      | Transition
      | undefined,
    whileHover: m.hover as TargetAndTransition | undefined,
  };
}
