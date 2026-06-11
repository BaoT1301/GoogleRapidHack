/**
 * Geographic Mapper — maps file paths to lat/lng coordinates using
 * recursive subdivision of the coordinate space.
 *
 * Algorithm: At each folder level, alternate between latitude and longitude
 * splits. Siblings at each level divide the current region equally.
 * The file is placed at the center of its final region.
 *
 * Deterministic: same file path + same sibling set → same coordinates.
 */

interface Coordinates {
  lat: number;
  lng: number;
}

interface Region {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/**
 * Resolve sibling folder/file names at a given path prefix from the full file list.
 */
function resolveSiblings(prefix: string, allFilePaths: string[]): string[] {
  const siblings = new Set<string>();

  for (const filePath of allFilePaths) {
    if (!filePath.startsWith(prefix)) {
      continue;
    }

    const remainder = filePath.slice(prefix.length);
    const firstSegment = remainder.split("/")[0];
    if (firstSegment) {
      siblings.add(firstSegment);
    }
  }

  // Sort for deterministic ordering
  return [...siblings].sort();
}

/**
 * Map a file path to geographic coordinates.
 *
 * @param filePath - The file path relative to workspace root (e.g., "backend/app/main.py")
 * @param clusterPath - The cluster's base path (e.g., "backend/")
 * @param allFilePaths - All file paths in the cluster for sibling resolution
 * @returns Coordinates with lat ∈ [-90, 90] and lng ∈ [-180, 180]
 */
export function mapFileToCoordinates(
  filePath: string,
  clusterPath: string,
  allFilePaths: string[],
): Coordinates {
  // Strip the cluster path prefix to get the relative path within the cluster
  const relativePath = filePath.startsWith(clusterPath)
    ? filePath.slice(clusterPath.length)
    : filePath;

  const segments = relativePath.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { lat: 0, lng: 0 };
  }

  // Filter allFilePaths to only those within this cluster
  const clusterFiles = allFilePaths.filter((fp) => fp.startsWith(clusterPath));

  let region: Region = {
    latMin: -90,
    latMax: 90,
    lngMin: -180,
    lngMax: 180,
  };

  let currentPrefix = clusterPath;

  for (let depth = 0; depth < segments.length; depth++) {
    const segment = segments[depth];
    const siblings = resolveSiblings(currentPrefix, clusterFiles);

    if (siblings.length === 0) {
      break;
    }

    const index = siblings.indexOf(segment);
    if (index === -1) {
      // Segment not found among siblings — place at center of current region
      break;
    }

    const count = siblings.length;

    // Alternate between latitude (even depth) and longitude (odd depth)
    if (depth % 2 === 0) {
      // Split latitude
      const latRange = region.latMax - region.latMin;
      const sliceSize = latRange / count;
      region = {
        ...region,
        latMin: region.latMin + index * sliceSize,
        latMax: region.latMin + (index + 1) * sliceSize,
      };
    } else {
      // Split longitude
      const lngRange = region.lngMax - region.lngMin;
      const sliceSize = lngRange / count;
      region = {
        ...region,
        lngMin: region.lngMin + index * sliceSize,
        lngMax: region.lngMin + (index + 1) * sliceSize,
      };
    }

    currentPrefix = currentPrefix + segment + "/";
  }

  // Place at center of final region
  const lat = (region.latMin + region.latMax) / 2;
  const lng = (region.lngMin + region.lngMax) / 2;

  // Clamp to valid bounds (should already be within bounds, but safety check)
  return {
    lat: Math.max(-90, Math.min(90, lat)),
    lng: Math.max(-180, Math.min(180, lng)),
  };
}
