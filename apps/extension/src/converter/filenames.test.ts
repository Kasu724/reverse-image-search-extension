import { describe, expect, it } from "vitest";
import {
  deriveDownloadFilename,
  extractFilenameFromUrl,
  formatTimestamp,
  parseContentDispositionFilename,
  replaceExtension,
  sanitizeFilename
} from "./filenames";

describe("converter filename helpers", () => {
  it("sanitizes filenames for common filesystems", () => {
    expect(sanitizeFilename("bad:name*with?chars.png")).toBe("bad-name-with-chars.png");
    expect(sanitizeFilename("  .hidden.  ")).toBe("hidden");
    expect(sanitizeFilename("CON")).toBe("image");
  });

  it("replaces existing extensions", () => {
    expect(replaceExtension("photo.large.jpeg", "png")).toBe("photo.large.png");
    expect(replaceExtension("download", ".webp")).toBe("download.webp");
  });

  it("extracts filenames from URLs without query strings or fragments", () => {
    expect(
      extractFilenameFromUrl("https://example.com/assets/cat%20photo.jpg?width=600#preview")
    ).toBe("cat photo.jpg");
    expect(extractFilenameFromUrl("data:image/png;base64,AAAA")).toBe("");
    expect(extractFilenameFromUrl("blob:https://example.com/uuid")).toBe("");
  });

  it("parses content disposition filenames", () => {
    expect(parseContentDispositionFilename('attachment; filename="poster.webp"')).toBe("poster.webp");
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''cat%20poster.png")).toBe(
      "cat poster.png"
    );
  });

  it("derives fallback filenames from host and timestamp", () => {
    const now = new Date(Date.UTC(2026, 3, 23, 5, 6, 7));
    expect(formatTimestamp(now)).toBe("20260423-050607");
    expect(
      deriveDownloadFilename({
        sourceUrl: "https://images.example.com/",
        targetExtension: "jpg",
        now
      })
    ).toBe("images.example.com-20260423-050607.jpg");
  });
});
