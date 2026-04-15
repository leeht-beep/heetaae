import { execFileSync } from "node:child_process";

const chromePath = process.env.MERCARI_RENDER_CHROME_PATH;
const url = process.env.MERCARI_RENDER_URL;
const windowSize = process.env.MERCARI_RENDER_WINDOW_SIZE ?? "1600,5000";
const virtualTimeBudget = process.env.MERCARI_RENDER_VIRTUAL_TIME_BUDGET ?? "7000";
const userAgent = process.env.MERCARI_RENDER_USER_AGENT;
const profileDir = process.env.MERCARI_RENDER_PROFILE_DIR;
const timeoutMs = Number(process.env.MERCARI_RENDER_TIMEOUT_MS ?? "22000");

if (!chromePath || !url || !userAgent || !profileDir) {
  console.error("Missing Mercari dump-dom environment variables.");
  process.exit(1);
}

const stdout = execFileSync(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=Translate,MediaRouter,OptimizationGuideModelDownloading",
    `--window-size=${windowSize}`,
    `--virtual-time-budget=${virtualTimeBudget}`,
    `--user-agent=${userAgent}`,
    "--lang=ja-JP",
    `--user-data-dir=${profileDir}`,
    "--dump-dom",
    url,
  ],
  {
    timeout: timeoutMs,
    maxBuffer: 14 * 1024 * 1024,
    windowsHide: true,
    encoding: "utf8",
  },
);

process.stdout.write(stdout);
