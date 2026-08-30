import { describe, expect, it } from "vitest";
import {
  buildEnabledSearchUrls,
  buildSearchUrl,
  getUnsupportedImageReason,
  isNetworkImageUrl
} from "./searchEngines";

describe("search engine URL builders", () => {
  const imageUrl = "https://example.com/images/cat with spaces.jpg?size=large&ref=unit";

  it("does not build an external Google Lens URL in local-only mode", () => {
    const result = buildSearchUrl("google", imageUrl);
    expect(result.ok).toBe(false);
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain("disabled in local-only mode");
  });

  it("does not build an external Bing URL in local-only mode", () => {
    const result = buildSearchUrl("bing", imageUrl);
    expect(result.ok).toBe(false);
    expect(result.url).toBeUndefined();
  });

  it("does not build an external TinEye URL in local-only mode", () => {
    const result = buildSearchUrl("tineye", imageUrl);
    expect(result.ok).toBe(false);
    expect(result.url).toBeUndefined();
  });

  it("does not build an external Yandex URL in local-only mode", () => {
    const result = buildSearchUrl("yandex", imageUrl);
    expect(result.ok).toBe(false);
    expect(result.url).toBeUndefined();
  });

  it("does not build an external SauceNAO URL in local-only mode", () => {
    const result = buildSearchUrl("saucenao", imageUrl);
    expect(result.ok).toBe(false);
    expect(result.url).toBeUndefined();
  });

  it("rejects blob, data, and local URLs", () => {
    expect(isNetworkImageUrl("blob:https://example.com/abc")).toBe(false);
    expect(buildSearchUrl("google", "data:image/png;base64,abc").ok).toBe(false);
    expect(getUnsupportedImageReason("file:///tmp/image.png")).toContain("Local file");
  });

  it("builds an entry per enabled engine", () => {
    const results = buildEnabledSearchUrls(["google", "tineye"], imageUrl);
    expect(results.map((result) => result.engineId)).toEqual(["google", "tineye"]);
    expect(results.every((result) => !result.result.ok)).toBe(true);
    expect(results.every((result) => !result.result.url)).toBe(true);
  });
});
