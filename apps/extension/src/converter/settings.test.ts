import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DOWNLOAD_MODES,
  MAX_RESIZE_DIMENSION,
  MIN_COMPRESSION_TARGET_BYTES,
  clampQuality,
  normalizeCompressionTargetBytes,
  normalizeHexColor,
  normalizeResizeDimension,
  normalizeSettings
} from "./settings";

describe("converter settings", () => {
  it("normalizes settings with defaults", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps quality values", () => {
    expect(clampQuality(2, 0.9)).toBe(1);
    expect(clampQuality(0.01, 0.9)).toBe(0.1);
    expect(clampQuality("0.456", 0.9)).toBe(0.46);
    expect(clampQuality("bad", 0.9)).toBe(0.9);
  });

  it("normalizes colors", () => {
    expect(normalizeHexColor("#fff")).toBe("#FFFFFF");
    expect(normalizeHexColor("0d6b57")).toBe("#0D6B57");
    expect(normalizeHexColor("not-a-color")).toBe("#FFFFFF");
  });

  it("normalizes resize dimensions", () => {
    expect(normalizeResizeDimension("")).toBeNull();
    expect(normalizeResizeDimension("bad")).toBeNull();
    expect(normalizeResizeDimension("1200.4")).toBe(1200);
    expect(normalizeResizeDimension(-1)).toBeNull();
    expect(normalizeResizeDimension(MAX_RESIZE_DIMENSION + 1000)).toBe(MAX_RESIZE_DIMENSION);
  });

  it("normalizes compression targets", () => {
    expect(normalizeCompressionTargetBytes(10)).toBe(MIN_COMPRESSION_TARGET_BYTES);
    expect(normalizeCompressionTargetBytes("1048576")).toBe(1048576);
    expect(normalizeCompressionTargetBytes("bad")).toBe(DEFAULT_SETTINGS.compressionTargetBytes);
  });

  it("drops invalid formats while preserving booleans", () => {
    const normalized = normalizeSettings({
      defaultFormat: "gif",
      askWhereToSave: false,
      skipRedundantConversion: true,
      preserveDimensions: false,
      resizeWidth: "1440",
      resizeHeight: "810",
      compressionTargetBytes: "1048576",
      compressionMinQuality: "0.42",
      compressionAllowResize: false
    });

    expect(normalized.defaultFormat).toBe(DEFAULT_SETTINGS.defaultFormat);
    expect(normalized.askWhereToSave).toBe(false);
    expect(normalized.downloadMode).toBe(DOWNLOAD_MODES.AUTO);
    expect(normalized.skipRedundantConversion).toBe(true);
    expect(normalized.preserveDimensions).toBe(false);
    expect(normalized.resizeWidth).toBe(1440);
    expect(normalized.resizeHeight).toBe(810);
    expect(normalized.compressionTargetBytes).toBe(1048576);
    expect(normalized.compressionMinQuality).toBe(0.42);
    expect(normalized.compressionAllowResize).toBe(false);
  });
});
