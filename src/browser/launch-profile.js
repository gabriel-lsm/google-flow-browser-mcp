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

  // PRIORITY 1: Connect to already-running Chrome via CDP (start-browser.ps1 case)
  // This works regardless of which profile Chrome was launched with.
  try {
    const existing = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    logger.info('Found existing Chrome instance via CDP, reusing (no profile check needed)');
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
    logger.info('No existing Chrome on CDP port, will launch new instance');
  }

  // PRIORITY 2: Launch Chrome directly with the configured profile
  // Windows: AppData\Local\Google\Chrome\User Data\Profile 1 (or Profile 3)
  // Linux:   .config/google-chrome/Profile 1
  const chromeUserDataDir = get('chromeUserDataDir', null);
  const chromeProfile = get('chromeProfile', 'Default');

  // Try the configured profile first, then fall back to Default / Profile 1
  const profileCandidates = process.platform === 'win32'
    ? [
        chromeUserDataDir
          ? path.join(chromeUserDataDir, chromeProfile)
          : path.resolve(HOME_DIR, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', chromeProfile),
        path.resolve(HOME_DIR, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default'),
        path.resolve(HOME_DIR, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Profile 1'),
      ]
    : [
        path.resolve(HOME_DIR, '.config/google-chrome', chromeProfile),
        path.resolve(HOME_DIR, '.config/google-chrome/Default'),
        path.resolve(HOME_DIR, '.config/google-chrome/Profile 1'),
      ];

  const profileSource = profileCandidates.find(p => fs.existsSync(p));

  if (!profileSource) {
    throw new FlowError(ErrorCodes.CONFIG_ERROR,
      `No Chrome profile found. Tried: ${profileCandidates.join(', ')}. ` +
      'Run start-browser.ps1 first to launch Chrome with CDP, then call flow_connect again.');
  }

  logger.info('Launching Chrome via direct+CDP method', { profileSource });
  return await launchChromeDirect({
    chromePath: resolveChromePath(),
    cdpPort: CDP_PORT,
    headless,
    profileSource,
  });
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
