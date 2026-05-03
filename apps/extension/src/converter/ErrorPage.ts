import "./errorPage.css";

const params = new URLSearchParams(location.search);

setText("#message", params.get("message") || "The image could not be converted.");
setText("#code", params.get("code") || "unknown_error");
setText("#target", params.get("target") || "Unknown");
setText("#source-format", params.get("sourceFormat") || "Unknown");
setText("#source-url", params.get("sourceUrl") || "Not available");

document.querySelector("#open-options")?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

document.querySelector("#close-page")?.addEventListener("click", () => {
  window.close();
});

function setText(selector: string, value: string): void {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}
