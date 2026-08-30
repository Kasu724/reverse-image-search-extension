import { describe, expect, it } from "vitest";
import { ConversionError } from "./errors";
import {
  buildSizedSvg,
  dataUrlToBlob,
  normalizeCropRect,
  withMimeType
} from "./imageConverter";

describe("converter input safety", () => {
  it("decodes case-insensitive base64 data URLs without using fetch", () => {
    const blob = dataUrlToBlob("DATA:IMAGE/PNG;BASE64,iVBORw==");

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(4);
  });

  it("rejects malformed embedded data instead of passing it to a browser fetch", () => {
    expect(() => dataUrlToBlob("data:image/png;base64,not valid base64!")).toThrow(ConversionError);
    expect(() => dataUrlToBlob("data:image/png")).toThrow(ConversionError);
    expect(() => dataUrlToBlob("https://example.test/image.png")).toThrow(ConversionError);
  });

  it("decodes URL-encoded UTF-8 payloads and applies a fallback MIME type", () => {
    const blob = dataUrlToBlob("data:,hello%20%E2%9C%93", "image/svg+xml");

    expect(blob.type).toBe("image/svg+xml");
    expect(blob.size).toBe(new TextEncoder().encode("hello ✓").byteLength);
  });

  it("preserves percent-encoded binary bytes alongside unescaped UTF-8", () => {
    const blob = dataUrlToBlob("data:application/octet-stream,%89é");

    expect(blob.size).toBe(3);
  });

  it("normalizes the MIME when the redundant-conversion source type is spoofed", () => {
    const blob = withMimeType(new Blob(["bytes"], { type: "text/plain" }), "image/png");

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(5);
  });
});

describe("SVG conversion safety", () => {
  it("rejects external and executable SVG content", () => {
    expect(() => buildSizedSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/a.png" /></svg>'))
      .toThrowError(/external resource/i);
    expect(() => buildSizedSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.test/symbol.svg#icon" /></svg>'))
      .toThrowError(/external resource/i);
    expect(() => buildSizedSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.icon { fill: url("https://example.test/fill.svg") }</style></svg>'))
      .toThrowError(/external resource/i);
    expect(() => buildSizedSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
      .toThrowError(/active or embedded/i);
  });

  it("preserves a non-fetching external hyperlink", () => {
    const result = buildSizedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.test/info"><text>Info</text></a></svg>'
    );

    expect(result.text).toContain('href="https://example.test/info"');
  });

  it("preserves embedded SVG data and computes bounded dimensions", () => {
    const result = buildSizedSvg(
      '<svg viewBox="0 0 2 1"><image href="data:image/png;base64,iVBORw==" /></svg>'
    );

    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(result.text).toContain('width="2"');
    expect(result.text).toContain('height="1"');
  });
});

describe("crop bounds", () => {
  it("clamps malformed crop coordinates to the decoded image", () => {
    expect(normalizeCropRect({ x: 99, y: -3, width: 100, height: 100 }, 4, 3)).toEqual({
      x: 3,
      y: 0,
      width: 1,
      height: 3
    });
  });
});
