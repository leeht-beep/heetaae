export const MERCARI_BASE_URL = "https://jp.mercari.com";
export const MERCARI_SEARCH_PATH = "/search";
export const MERCARI_DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
export const MERCARI_DEFAULT_ACCEPT_LANGUAGE = "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7";
export const MERCARI_HTTP_TIMEOUT_MS = 8000;
export const MERCARI_BROWSER_TIMEOUT_MS = 20000;
export const MERCARI_BROWSER_VIRTUAL_TIME_BUDGET_MS = 12000;
export const MERCARI_REQUEST_INTERVAL_MS = 650;
export const MERCARI_WINDOW_SIZE = "1600,5000";

export const MERCARI_CHROME_CANDIDATES = [
  process.env.MERCARI_CHROME_PATH,
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value));
