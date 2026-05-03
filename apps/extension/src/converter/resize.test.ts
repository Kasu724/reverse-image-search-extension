import { describe, expect, it } from "vitest";
import { calculateOutputDimensions } from "./imageConverter";

describe("converter resize calculations", () => {
  it("keeps original dimensions when preserveDimensions is enabled", () => {
    expect(calculateOutputDimensions(2400, 1600, { preserveDimensions: true })).toEqual({
      width: 2400,
      height: 1600
    });
  });

  it("fits within both max width and max height while preserving aspect ratio", () => {
    expect(
      calculateOutputDimensions(2400, 1600, {
        preserveDimensions: false,
        resizeWidth: 1200,
        resizeHeight: 1200
      })
    ).toEqual({
      width: 1200,
      height: 800
    });
  });

  it("supports a single resize bound", () => {
    expect(
      calculateOutputDimensions(2400, 1600, {
        preserveDimensions: false,
        resizeWidth: 900,
        resizeHeight: null
      })
    ).toEqual({
      width: 900,
      height: 600
    });
  });

  it("does not upscale images that are already smaller than the resize bounds", () => {
    expect(
      calculateOutputDimensions(800, 600, {
        preserveDimensions: false,
        resizeWidth: 1600,
        resizeHeight: 1200
      })
    ).toEqual({
      width: 800,
      height: 600
    });
  });
});
