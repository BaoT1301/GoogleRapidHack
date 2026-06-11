/**
 * GlobeLoadingScreen Component
 *
 * Displays a spinning globe icon with "Indexing files..." text and a
 * progress bar. Supports two modes:
 *   - Determinate: When `current` and `total` props are provided (total > 0),
 *     renders a static bar whose width reflects actual indexing progress.
 *   - Indeterminate: When progress data is absent, renders a pulsing bar
 *     as a fallback for late-connecting clients.
 *
 * Fades out with a 300ms CSS transition when loading completes.
 */

import { Globe } from "lucide-react";
import { computeProgress } from "./loading-screen-utils";

interface GlobeLoadingScreenProps {
  isLoading: boolean;
  current?: number;
  total?: number;
}

export function GlobeLoadingScreen({ isLoading, current, total }: GlobeLoadingScreenProps) {
  const hasDeterminateProgress =
    current !== undefined && total !== undefined && total > 0;

  const progressPercent = hasDeterminateProgress
    ? computeProgress(current, total)
    : 0;

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#000011] transition-opacity duration-300"
      style={{
        opacity: isLoading ? 1 : 0,
        pointerEvents: isLoading ? "auto" : "none",
      }}
    >
      <Globe className="h-16 w-16 text-blue-400 animate-spin mb-6" />
      <p className="text-gray-300 text-lg mb-4">
        {hasDeterminateProgress
          ? `Indexing files... ${current}/${total}`
          : "Indexing files..."}
      </p>
      {/* Progress bar */}
      <div className="w-64 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        {hasDeterminateProgress ? (
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-200"
            style={{ width: `${progressPercent}%` }}
          />
        ) : (
          <div
            className="h-full bg-blue-500 rounded-full animate-pulse"
            style={{ width: "60%" }}
          />
        )}
      </div>
    </div>
  );
}
