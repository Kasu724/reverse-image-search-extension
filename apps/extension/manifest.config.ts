const manifest: chrome.runtime.ManifestV3 = {
  manifest_version: 3,
  name: "ImageLab",
  version: "1.0.0",
  description:
    "Right-click image conversion, downloads, reverse search, local analysis, and optional cloud workflows.",
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
      run_at: "document_idle"
    }
  ],
  permissions: [
    "activeTab",
    "contextMenus",
    "downloads",
    "offscreen",
    "scripting",
    "storage",
    "tabs"
  ],
  host_permissions: ["http://*/*", "https://*/*"],
  icons: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src 'self' http://localhost:* http://127.0.0.1:* https://*;"
  }
};

export default manifest;
