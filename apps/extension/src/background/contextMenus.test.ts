import { describe, expect, it } from "vitest";
import { getImageContextMenuAction } from "./contextMenus";
import { CONTEXT_MENU_IDS } from "../shared/constants";

describe("local-only context menus", () => {
  it("does not expose reverse-search menu actions", () => {
    expect(
      getImageContextMenuAction({ menuItemId: CONTEXT_MENU_IDS.searchAll } as chrome.contextMenus.OnClickData)
    ).toBeNull();
    expect(
      getImageContextMenuAction({
        menuItemId: `${CONTEXT_MENU_IDS.searchEnginePrefix}google`
      } as chrome.contextMenus.OnClickData)
    ).toBeNull();
  });

  it("keeps local conversion and crop actions", () => {
    expect(
      getImageContextMenuAction({
        menuItemId: CONTEXT_MENU_IDS.convertDownloadPng
      } as chrome.contextMenus.OnClickData)
    ).toEqual({ type: "convert", format: "png" });
    expect(
      getImageContextMenuAction({
        menuItemId: CONTEXT_MENU_IDS.cropOpenEditor
      } as chrome.contextMenus.OnClickData)
    ).toEqual({ type: "crop-open" });
  });
});
