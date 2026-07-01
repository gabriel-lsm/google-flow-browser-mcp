import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { logger } from '../utils/logger.js';
import { get } from '../utils/config.js';
import { FlowError, ErrorCodes } from '../utils/errors.js';
import { launchChromeDirect, setPage, setContext, setConnected, setBrowser, isBrowserConnected } from './connect.js';

/** Cross-platform home directory (mirrors connect.js) */
const HOME_DIR = process.env.USERPROFILE || process.env.HOME || os.homedir();

/** Resolve Chrome executable path — cross-platform */
function resolveChromePath() {
  const fromConfig = get('chromePath', null);
  if (fromConfig) return fromConfig;
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return '/opt/google/chrome/chrome'; // Linux
}

const CDP_PORT = get('cdpPort', 9222);
const FLOW_URL = get('flowUrl', 'https://labs.google/fx/fr/tools/flow');

export async function launchKiaraProfile(headless = false) {
  if (isBrowserConnected()) {
    logger.info('Browser already connected, reusing');
    return { success: true, message: 'Already connected' };
  }

  // Windows: AppData\Local\Google\Chrome\User Data\Profile 3
  // Linux:   .config/google-chrome/Profile 3
  const profileSource = process.platform === 'win32'
    ? path.resolve(HOME_DIR, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Profile 3')
    : path.resolve(HOME_DIR, '.config/google-chrome/Profile 3');

  if (!fs.existsSync(profileSource)) {
    throw new FlowError(ErrorCodes.CONFIG_ERROR,
      `Profile 3 not found at ${profileSource}. Make sure Chrome Profile 3 exists and is configured with your Google account.`);
  }

  logger.info('Launching Chrome via direct+CDP method (anti-detection)', { profileSource });

  try {
    // Try connecting to existing Chrome instance first
    const existing = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    logger.info('Found existing Chrome instance, reusing');
    const ctx = existing.contexts()[0];
    const pg = ctx?.pages()[0];
    setBrowser(existing);
    setContext(ctx);
    setConnected(true);
    if (pg) { setPage(pg); return { browser: existing, context: ctx, page: pg }; }
    const newPage = await ctx.newPage();
    setPage(newPage);
    return { browser: existing, context: ctx, page: newPage };
  } catch {
    // Launch Chrome directly (not via Playwright) for anti-detection
    return await launchChromeDirect({
      chromePath: resolveChromePath(),
      cdpPort: CDP_PORT,
      headless,
      profileSource,
    });
  }
}

export async function navigateToFlow(page, toolPage) {
  const targetUrl = toolPage === true
    ? 'https://labs.google/fx/fr/tools/flow'
    : FLOW_URL;

  logger.info('Navigating to Google Flow', { url: targetUrl });
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const currentUrl = page.url();
  logger.info('Flow page loaded', { url: currentUrl.substring(0, 100) });

  if (currentUrl.includes('accounts.google.com')) {
    return { authenticated: false, url: currentUrl,
      message: 'OAuth blocked — Google detects automation. Use Chrome direct+CDP launch method.' };
  }

  return { authenticated: true, url: currentUrl };
}
