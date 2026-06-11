"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_PACK_ID,
  getPack,
  listPacks,
  type ThemePack,
} from "@/lib/canvas-theme";
import { applyCanvasConfig, type CanvasConfig } from "@/lib/canvas-theme/config";

interface CanvasThemeContextValue {
  /** The effective, resolved pack the canvas renders with (config applied). */
  pack: ThemePack;
  /** Id of the active pack. */
  packId: string;
  /** Switch the active pack by id (unknown ids fall back to Classic). */
  setPackId: (id: string) => void;
  /** Active per-user appearance overrides. */
  config: CanvasConfig;
  /** Merge a partial appearance config (local; persistence is the caller's job). */
  setConfig: (patch: CanvasConfig) => void;
  /** All selectable packs (id + name) for the Appearance picker. */
  availablePacks: { id: string; name: string }[];
}

const CanvasThemeContext = createContext<CanvasThemeContextValue | null>(null);

/**
 * Supplies the active canvas Theme Pack to the canvas subtree. Defaults to
 * Classic so the canvas looks identical until a pack is explicitly chosen.
 *
 * `initialPackId` / `initialConfig` seed the selection from persisted user
 * settings (Task 9). They are also treated as the live source of truth: when
 * they change (e.g. the Appearance tab persists a change and the settings query
 * refetches), the provider syncs — so a change made elsewhere re-skins an open
 * canvas. Pack selection lives here (not the global ThemeProvider) so re-skins
 * are scoped to the canvas and never touch app-wide light/dark.
 */
export function CanvasThemeProvider({
  children,
  initialPackId = DEFAULT_PACK_ID,
  initialConfig,
  extraPacks,
}: {
  children: React.ReactNode;
  initialPackId?: string;
  initialConfig?: CanvasConfig | null;
  /** User custom packs (from `themePacks.list`) merged with the built-ins. */
  extraPacks?: ThemePack[];
}) {
  const [packId, setPackId] = useState<string>(initialPackId);
  const [config, setConfigState] = useState<CanvasConfig>(initialConfig ?? {});

  // Sync when the persisted seed changes (settings refetch / cross-component).
  useEffect(() => {
    setPackId(initialPackId);
  }, [initialPackId]);
  const configSeed = JSON.stringify(initialConfig ?? {});
  useEffect(() => {
    setConfigState(initialConfig ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by serialized seed
  }, [configSeed]);

  // User packs indexed by id (override/extend the built-in registry).
  const extraById = useMemo(() => {
    const m: Record<string, ThemePack> = {};
    for (const p of extraPacks ?? []) m[p.id] = p;
    return m;
  }, [extraPacks]);

  const pack = useMemo(
    () => applyCanvasConfig(extraById[packId] ?? getPack(packId), config),
    [packId, config, extraById],
  );
  const availablePacks = useMemo(
    () => [
      ...listPacks(),
      ...(extraPacks ?? []).map((p) => ({ id: p.id, name: p.name })),
    ],
    [extraPacks],
  );

  const handleSetPackId = useCallback((id: string) => setPackId(id), []);
  const setConfig = useCallback(
    (patch: CanvasConfig) => setConfigState((c) => ({ ...c, ...patch })),
    [],
  );

  const value = useMemo<CanvasThemeContextValue>(
    () => ({
      pack,
      packId,
      setPackId: handleSetPackId,
      config,
      setConfig,
      availablePacks,
    }),
    [pack, packId, handleSetPackId, config, setConfig, availablePacks],
  );

  return (
    <CanvasThemeContext.Provider value={value}>
      {children}
    </CanvasThemeContext.Provider>
  );
}

/** Access the active canvas Theme Pack. Throws if used outside the provider. */
export function useCanvasTheme(): CanvasThemeContextValue {
  const ctx = useContext(CanvasThemeContext);
  if (!ctx) {
    throw new Error("useCanvasTheme must be used within a CanvasThemeProvider");
  }
  return ctx;
}
