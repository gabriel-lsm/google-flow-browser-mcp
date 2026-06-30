/**
 * session-manager.js
 * Manages Google Flow session persistence:
 *   - Save: captures cookies + localStorage + sessionStorage to disk
 *   - Restore: injects saved session data back into the browser context
 *   - IsLoggedIn: deterministic check without full DOM scan
 *   - DetectExpiry: detects redirect to Google sign-in
 *
 * Session file path: config.sessionFile (default: config/flow.session.json)
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { get } from '../utils/config.js';

const SESSION_FILE = path.resolve(
  get('flowHome', '.'),
  get('sessionFile', 'config/flow.session.json')
);

const FLOW_ORIGIN = 'https://labs.google';
const FLOW_URL = get('flowUrl', 'https://labs.google/fx/tools/flow');

/* -------------------------------------------------------------------------- */
/*  Save                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Save the current browser session (cookies + storage) to disk.
 * Call after a successful login or when the session is known-good.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} page
 * @returns {Promise<{ saved: boolean, cookieCount: number, path: string }>}
 */
export async function saveSession(context, page) {
  try {
    const cookies = await context.cookies([FLOW_ORIGIN, 'https://accounts.google.com']);

    const storage = await page.evaluate(() => {
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        ls[k] = localStorage.getItem(k);
      }
      const ss = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        ss[k] = sessionStorage.getItem(k);
      }
      return { localStorage: ls, sessionStorage: ss };
    }).catch(() => ({ localStorage: {}, sessionStorage: {} }));

    const session = {
      savedAt: new Date().toISOString(),
      url: page.url(),
      cookies,
      ...storage,
    };

    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

    logger.info('Session saved', { cookieCount: cookies.length, path: SESSION_FILE });
    return { saved: true, cookieCount: cookies.length, path: SESSION_FILE };
  } catch (err) {
    logger.warn('Failed to save session', { error: err.message });
    return { saved: false, error: err.message };
  }
}

/* -------------------------------------------------------------------------- */
/*  Restore                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Restore a previously saved session into the browser context.
 * Must be called BEFORE navigating to the target URL for cookies to apply.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} page
 * @returns {Promise<{ restored: boolean, cookieCount: number, age_hours: number|null }>}
 */
export async function restoreSession(context, page) {
  if (!fs.existsSync(SESSION_FILE)) {
    logger.info('No session file found — fresh session', { path: SESSION_FILE });
    return { restored: false, reason: 'no_session_file' };
  }

  let session;
  try {
    session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  } catch (err) {
    logger.warn('Could not parse session file', { error: err.message });
    return { restored: false, reason: 'parse_error' };
  }

  const savedAt = new Date(session.savedAt);
  const ageMs = Date.now() - savedAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  // Google sessions typically last 1-2 weeks; warn after 7 days
  if (ageHours > 168) {
    logger.warn('Session is older than 7 days — may be expired', { ageHours: Math.round(ageHours) });
  }

  try {
    // Restore cookies
    if (session.cookies && session.cookies.length > 0) {
      await context.addCookies(session.cookies);
      logger.info('Cookies restored', { count: session.cookies.length });
    }

    // Restore localStorage & sessionStorage via about:blank then navigate
    // We need a page load on the origin first for storage to apply
    const storageKeys = Object.keys(session.localStorage || {});
    if (storageKeys.length > 0) {
      await page.goto(FLOW_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.evaluate((ls) => {
        for (const [k, v] of Object.entries(ls)) {
          try { localStorage.setItem(k, v); } catch {}
        }
      }, session.localStorage || {}).catch(() => {});
      logger.info('localStorage restored', { keys: storageKeys.length });
    }

    return {
      restored: true,
      cookieCount: session.cookies?.length || 0,
      age_hours: Math.round(ageHours * 10) / 10,
    };
  } catch (err) {
    logger.warn('Failed to restore session', { error: err.message });
    return { restored: false, reason: 'restore_error', error: err.message };
  }
}

/* -------------------------------------------------------------------------- */
/*  Login detection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic login check — no full DOM scan.
 * Uses a targeted evaluate() looking for specific known selectors.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ loggedIn: boolean, account: string|null, method: string }>}
 */
export async function isLoggedIn(page) {
  const url = page.url();

  // Fast path: URL is the Google sign-in page
  if (url.includes('accounts.google.com')) {
    return { loggedIn: false, account: null, method: 'url_check' };
  }

  const result = await page.evaluate(() => {
    // Check 1: Google account avatar (most reliable)
    const avatar = document.querySelector(
      'img[data-email], [aria-label*="Google Account"], [data-componentid*="avatar"]'
    );
    if (avatar) {
      const email = avatar.getAttribute('data-email') || avatar.getAttribute('aria-label') || null;
      return { loggedIn: true, account: email, selector: 'avatar' };
    }

    // Check 2: Profile picture in header (img with alt containing @)
    const profileImg = Array.from(document.querySelectorAll('img')).find(img => {
      const alt = img.alt || '';
      return alt.includes('@') || alt.includes('Google Account');
    });
    if (profileImg) {
      return { loggedIn: true, account: profileImg.alt || null, selector: 'profile_img' };
    }

    // Check 3: Sign-in button visible = not logged in
    const signInBtn = Array.from(document.querySelectorAll('a, button')).find(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      const href = el.getAttribute('href') || '';
      return text === 'sign in' || text === 'se connecter' || href.includes('accounts.google.com');
    });
    if (signInBtn) {
      return { loggedIn: false, account: null, selector: 'sign_in_btn' };
    }

    // Check 4: Flow-specific — if the home page loaded (has "New project" btn) = logged in
    const hasFlowUI = document.querySelector(
      '[class*="project"], [class*="flow"], [class*="media-grid"]'
    );
    if (hasFlowUI) {
      return { loggedIn: true, account: null, selector: 'flow_ui' };
    }

    return { loggedIn: null, account: null, selector: 'inconclusive' };
  }).catch(() => ({ loggedIn: null, account: null, selector: 'error' }));

  return { ...result, method: 'dom_check' };
}

/* -------------------------------------------------------------------------- */
/*  Expiry detection                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Check if the current session has expired (redirected to login or token error).
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
export async function isSessionExpired(page) {
  const url = page.url();
  if (url.includes('accounts.google.com')) return true;

  // Check for auth error in body text (e.g. "401", "session expired", "sign in to continue")
  const expired = await page.evaluate(() => {
    const text = (document.body.innerText || '').toLowerCase();
    return (
      text.includes('sign in to continue') ||
      text.includes('session expired') ||
      text.includes('your session has') ||
      text.includes('401')
    );
  }).catch(() => false);

  return expired;
}

/* -------------------------------------------------------------------------- */
/*  Session file info                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Returns metadata about the saved session without loading browser.
 */
export function getSessionInfo() {
  if (!fs.existsSync(SESSION_FILE)) {
    return { exists: false, path: SESSION_FILE };
  }
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    const ageHours = (Date.now() - new Date(s.savedAt).getTime()) / (1000 * 60 * 60);
    return {
      exists: true,
      path: SESSION_FILE,
      savedAt: s.savedAt,
      age_hours: Math.round(ageHours * 10) / 10,
      cookieCount: s.cookies?.length || 0,
      likely_valid: ageHours < 168,
    };
  } catch {
    return { exists: true, path: SESSION_FILE, parse_error: true };
  }
}
