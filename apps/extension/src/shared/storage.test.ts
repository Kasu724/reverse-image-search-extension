import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_HISTORY_STORAGE_BYTES, STORAGE_KEYS } from "./constants";
import { getHistory, upsertHistoryEntry } from "./storage";
import type { SelectedImage } from "./types";

const state: Record<string, unknown> = {};
let runtimeLastError: { message: string } | undefined;

beforeEach(() => {
  for (const key of Object.keys(state)) delete state[key];
  runtimeLastError = undefined;
  vi.stubGlobal("chrome", {
    runtime: {
      get lastError() {
        return runtimeLastError;
      }
    },
    storage: {
      local: {
        get: (keys: string[] | Record<string, unknown>, cb: (value: Record<string, unknown>) => void) => {
          const names = Array.isArray(keys) ? keys : Object.keys(keys);
          const result: Record<string, unknown> = {};
          for (const key of names) result[key] = key in state ? state[key] : (keys as Record<string, unknown>)[key];
          cb(result);
        },
        set: (items: Record<string, unknown>, cb: () => void) => {
          Object.assign(state, items);
          cb();
        }
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    }
  });
});

function image(id: string, extra: Partial<SelectedImage> = {}): SelectedImage {
  return { id, srcUrl: `data:image/png;base64,${id}`, capturedAt: new Date().toISOString(), ...extra };
}

describe("local history storage", () => {
  it("surfaces storage read failures", async () => {
    runtimeLastError = { message: "Storage is unavailable." };

    await expect(getHistory()).rejects.toThrow("Storage is unavailable.");
  });

  it("serializes concurrent upserts and preserves newer stored metadata", async () => {
    await upsertHistoryEntry(image("same", { title: "newer", width: 100 }));
    await Promise.all([
      upsertHistoryEntry(image("same", { title: undefined, analysis: { dominantColors: [], analyzedAt: "later" } })),
      upsertHistoryEntry(image("other", { title: "other" }))
    ]);
    const entry = (await getHistory()).find((item) => item.id === "same");
    expect(entry?.image.title).toBe("newer");
    expect(entry?.image.analysis?.analyzedAt).toBe("later");
  });

  it("drops oldest entries when embedded history exceeds its byte budget", async () => {
    const large = "x".repeat(Math.ceil(MAX_HISTORY_STORAGE_BYTES * 0.7));
    await upsertHistoryEntry(image("first", { srcUrl: `data:image/png;base64,${large}` }));
    await upsertHistoryEntry(image("second", { srcUrl: `data:image/png;base64,${large}` }));
    const history = await getHistory();
    expect(history.map((item) => item.id)).toEqual(["second"]);
  });
});
