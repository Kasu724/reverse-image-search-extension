const manifest: chrome.runtime.ManifestV3 = {
  manifest_version: 3,
  name: "ImageLab",
  version: "1.0.0",
  description:
    "Local-only right-click image conversion, downloads, cropping, compression, and analysis.",
  minimum_chrome_version: "109",
  action: {
    default_title: "ImageLab",
    default_popup: "popup.html",
    default_icon: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  options_page: "options.html",
  background: {
    service_worker: "background/serviceWorker.js",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["content/contentScript.js"],
      run_at: "document_idle",
      all_frames: true
    }
  ],
  permissions: [
    "activeTab",
    "clipboardWrite",
    "contextMenus",
    "downloads",
    "offscreen",
    "scripting",
    "storage"
  ],
  host_permissions: ["http://*/*", "https://*/*"],
  icons: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  content_security_policy: {
    // HTTP(S) is required only to read the image the user selected on a page;
    // no extension code uses it for cloud/API or telemetry requests.
    extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' http: https:;"
  }
};

export default manifest;
