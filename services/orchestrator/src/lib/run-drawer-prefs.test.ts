// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDrawerPrefs,
  saveDrawerPrefs,
  clampDrawerHeight,
  DEFAULT_DRAWER_PREFS,
  DRAWER_MIN_HEIGHT,
  DRAWER_MAX_HEIGHT,
  DRAWER_DEFAULT_HEIGHT,
} from "./run-drawer-prefs";

const KEY = "orchestrator:runDrawerPrefs";

describe("run-drawer-prefs storage helper", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("returns defaults when nothing is saved", () => {
    expect(getDrawerPrefs()).toEqual(DEFAULT_DRAWER_PREFS);
  });

  it("round-trips a valid prefs object", () => {
    saveDrawerPrefs({ height: 400, collapsed: true });
    expect(getDrawerPrefs()).toEqual({ height: 400, collapsed: true });
  });

  it("clamps height below the minimum on read and write", () => {
    saveDrawerPrefs({ height: 10, collapsed: false });
    expect(getDrawerPrefs().height).toBe(DRAWER_MIN_HEIGHT);
  });

  it("clamps height above the maximum on read and write", () => {
    saveDrawerPrefs({ height: 9999, collapsed: false });
    expect(getDrawerPrefs().height).toBe(DRAWER_MAX_HEIGHT);
  });

  it("clampDrawerHeight falls back to default on non-finite input", () => {
    expect(clampDrawerHeight(Number.NaN)).toBe(DRAWER_DEFAULT_HEIGHT);
    expect(clampDrawerHeight(Infinity)).toBe(DRAWER_DEFAULT_HEIGHT);
  });

  it("clampDrawerHeight bounds finite values", () => {
    expect(clampDrawerHeight(10)).toBe(DRAWER_MIN_HEIGHT);
    expect(clampDrawerHeight(9999)).toBe(DRAWER_MAX_HEIGHT);
    expect(clampDrawerHeight(300)).toBe(300);
  });

  it("falls back to defaults on malformed JSON", () => {
    window.localStorage.setItem(KEY, "{not-json}");
    expect(getDrawerPrefs()).toEqual(DEFAULT_DRAWER_PREFS);
  });

  it("coerces a missing/invalid collapsed flag to false", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ height: 300 }));
    expect(getDrawerPrefs()).toEqual({ height: 300, collapsed: false });
  });

  it("coerces a missing height to the default", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ collapsed: true }));
    expect(getDrawerPrefs()).toEqual({
      height: DRAWER_DEFAULT_HEIGHT,
      collapsed: true,
    });
  });
});
