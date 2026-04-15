import os from "node:os";
import path from "node:path";

export const MERCARI_BASE_URL = "https://jp.mercari.com";
export const MERCARI_SEARCH_PATH = "/search";
export const MERCARI_DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
export const MERCARI_DEFAULT_ACCEPT_LANGUAGE = "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7";
export const MERCARI_HTTP_TIMEOUT_MS = 8000;
export const MERCARI_BROWSER_TIMEOUT_MS = 22000;
export const MERCARI_BROWSER_VIRTUAL_TIME_BUDGET_MS = 7000;
export const MERCARI_REQUEST_INTERVAL_MS = 650;
export const MERCARI_WINDOW_SIZE = "1600,5000";
export const MERCARI_SESSION_COOLDOWN_MS = 90_000;
export const MERCARI_SESSION_WARMUP_TTL_MS = 12 * 60 * 1000;
export const MERCARI_MAX_SESSION_RETRIES = 2;
export const MERCARI_SESSION_ROOT_DIR = path.join(
  process.env.MERCARI_SESSION_ROOT_DIR ?? os.tmpdir(),
  "market-resell-web-mvp",
  "mercari-sessions",
);
export const MERCARI_BROWSER_RENDERER =
  process.env.MERCARI_BROWSER_RENDERER ?? "auto";

export interface MercariRequestFingerprint {
  id: string;
  label: string;
  userAgent: string;
  acceptLanguage: string;
  windowSize?: string;
  headers?: Record<string, string>;
}

export const MERCARI_REQUEST_FINGERPRINTS: MercariRequestFingerprint[] = [
  {
    id: "chrome-ja-desktop-a",
    label: "Chrome JA Desktop A",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    acceptLanguage: "ja-JP,ja;q=0.95,en-US;q=0.78,en;q=0.66",
    windowSize: "1600,5000",
    headers: {
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
    },
  },
  {
    id: "chrome-ja-desktop-b",
    label: "Chrome JA Desktop B",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
    acceptLanguage: "ja,en-US;q=0.82,en;q=0.7",
    windowSize: "1536,4600",
    headers: {
      "Upgrade-Insecure-Requests": "1",
      DNT: "1",
    },
  },
  {
    id: "edge-ja-desktop",
    label: "Edge JA Desktop",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0",
    acceptLanguage: "ja-JP,ja;q=0.92,en-US;q=0.8,en;q=0.7",
    windowSize: "1720,5200",
    headers: {
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
    },
  },
];

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
