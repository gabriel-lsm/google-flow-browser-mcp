/**
 * state-detector.js
 * Lightweight, single-evaluate() state probe for the Google Flow UI.
 * Returns a deterministic snapshot of the current state WITHOUT
 * doing a full DOM scan (detectPageElements). Minimizes token usage.
 *
 * State shape:
 * {
 *   page: 'home' | 'project' | 'editor' | 'login' | 'tools' | 'unknown',
 *   mode: 'image' | 'video' | null,
 *   projectId: string | null,
 *   assetId: string | null,
 *   generating: boolean,
 *   generationStatus: 'idle' | 'queued' | 'generating' | 'ready' | 'failed',
 *   generationProgress: string | null,   // e.g. "45%"
 *   hasPromptInput: boolean,
 *   activeModel: string | null,
 *   loggedIn: boolean,
 *   url: string,
 * }
 */

import { logger } from '../utils/logger.js';
import { getPage } from './connect.js';

/**
 * Detect the current UI state in a single page.evaluate() call.
 * No repeated isVisible() loops — runs entirely in the browser context.
 *
 * @param {import('playwright').Page} [page] - Optional page (uses getPage() if omitted)
 * @returns {Promise<Object>}
 */
export async function detectState(page) {
  const pg = page || getPage();
  const url = pg.url();

  const state = await pg.evaluate((currentUrl) => {
    /* ---- URL parsing ---- */
    const path = (() => {
      try { return new URL(currentUrl).pathname; } catch { return currentUrl; }
    })();

    let pageType = 'unknown';
    let projectId = null;
    let assetId = null;

    if (currentUrl.includes('accounts.google.com')) {
      pageType = 'login';
    } else if (path.match(/\/project\/([^/]+)\/edit\/([^/]+)/)) {
      pageType = 'editor';
      const m = path.match(/\/project\/([^/]+)\/edit\/([^/]+)/);
      projectId = m[1];
      assetId = m[2];
    } else if (path.match(/\/project\/([^/]+)/)) {
      pageType = 'project';
      const m = path.match(/\/project\/([^/]+)/);
      projectId = m[1];
    } else if (path.includes('/tools')) {
      pageType = 'tools';
    } else if (path.includes('/flow') || path === '/') {
      pageType = 'home';
    }

    /* ---- Login detection ---- */
    // Logged in = no Google sign-in button visible, or user avatar present
    const signInBtn = document.querySelector(
      'a[href*="accounts.google.com"], button:has-text("Sign in"), [aria-label*="Sign in"]'
    );
    const avatarEl = document.querySelector(
      '[data-componentid*="avatar"], [class*="avatar"], img[alt*="@"], [aria-label*="Google Account"]'
    );
    const loggedIn = !!avatarEl || (pageType !== 'login' && !signInBtn);

    /* ---- Generation mode (Image vs Video) ---- */
    let mode = null;
    const imageTab = document.querySelector('button[role="tab"][id*="trigger-IMAGE"]');
    const videoTab = document.querySelector('button[role="tab"][id*="trigger-VIDEO"]');
    if (imageTab && imageTab.getAttribute('aria-selected') === 'true') {
      mode = 'image';
    } else if (videoTab && videoTab.getAttribute('aria-selected') === 'true') {
      mode = 'video';
    } else {
      // Fallback: read from model selector button text
      const modelBtn = Array.from(document.querySelectorAll('button'))
        .find(b => {
          const text = b.textContent || '';
          return (text.includes('Nano') || text.includes('Banana') ||
                  text.includes('Omni') || text.includes('Veo') ||
                  text.includes('Imagen')) && b.offsetParent !== null;
        });
      if (modelBtn) {
        const txt = modelBtn.textContent.trim();
        if (txt.includes('Omni') || txt.includes('Veo')) mode = 'video';
        else if (txt.includes('Nano') || txt.includes('Banana') || txt.includes('Imagen')) mode = 'image';
      }
    }

    /* ---- Active model ---- */
    let activeModel = null;
    const modelBtn = Array.from(document.querySelectorAll('button'))
      .find(b => {
        const text = b.textContent || '';
        return (text.includes('Nano') || text.includes('Banana') ||
                text.includes('Omni') || text.includes('Veo') ||
                text.includes('Imagen')) && b.offsetParent !== null;
      });
    if (modelBtn) {
      activeModel = modelBtn.textContent.trim().replace(/\s+/g, ' ').substring(0, 60);
    }

    /* ---- Generation status ---- */
    let generationStatus = 'idle';
    let generationProgress = null;
    let generating = false;

    // Check for progress indicators
    const bodyText = document.body.innerText || '';

    // Progress percentage
    const progressMatch = bodyText.match(/(\d+)%/);
    if (progressMatch) {
      generationProgress = progressMatch[1] + '%';
      generationStatus = 'generating';
      generating = true;
    }

    // Queued state
    if (bodyText.includes('Queued') || bodyText.includes('En attente') ||
        bodyText.includes('Na fila') || bodyText.includes('queue')) {
      generationStatus = 'queued';
      generating = true;
    }

    // Ready state (thumbnail appeared)
    const readyIndicator = document.querySelector(
      '[class*="ready"], [class*="complete"], img[src*="getMediaUrlRedirect"]'
    );
    if (readyIndicator && !generating) {
      generationStatus = 'ready';
    }

    // Failed state
    if (bodyText.includes('Failed') || bodyText.includes('Échec') ||
        bodyText.includes('Falhou') || document.querySelector('[class*="failed"], [class*="error"] [class*="warning"]')) {
      generationStatus = 'failed';
      generating = false;
    }

    // Spinning loader = still generating
    const spinner = document.querySelector(
      '[class*="spinner"], [class*="loading"], [role="progressbar"], [class*="circular"]'
    );
    if (spinner && spinner.offsetParent !== null) {
      generating = true;
      if (generationStatus === 'idle') generationStatus = 'generating';
    }

    /* ---- Prompt input ---- */
    const promptEl = document.querySelector(
      '[contenteditable="true"], textarea[placeholder]'
    );
    const hasPromptInput = !!(promptEl && promptEl.offsetParent !== null);

    return {
      page: pageType,
      mode,
      projectId,
      assetId,
      generating,
      generationStatus,
      generationProgress,
      hasPromptInput,
      activeModel,
      loggedIn,
      url: currentUrl,
    };
  }, url).catch(err => {
    logger.warn('state-detector: evaluate failed', { error: err.message });
    return {
      page: 'unknown',
      mode: null,
      projectId: null,
      assetId: null,
      generating: false,
      generationStatus: 'idle',
      generationProgress: null,
      hasPromptInput: false,
      activeModel: null,
      loggedIn: false,
      url,
      error: err.message,
    };
  });

  logger.debug('State detected', state);
  return state;
}

/**
 * Quick check: is the current URL inside a project?
 * @param {import('playwright').Page} [page]
 * @returns {boolean}
 */
export function isInProject(page) {
  const pg = page || getPage();
  return pg.url().includes('/project/');
}

/**
 * Quick check: extract project UUID from URL.
 * @param {import('playwright').Page} [page]
 * @returns {string|null}
 */
export function getProjectIdFromUrl(page) {
  const pg = page || getPage();
  const m = pg.url().match(/\/project\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Wait for a specific state condition with polling.
 * Does NOT call LLM — pure deterministic JS polling.
 *
 * @param {import('playwright').Page} page
 * @param {(state: Object) => boolean} predicate - Return true to stop waiting
 * @param {{ intervalMs?: number, timeoutMs?: number, label?: string }} options
 * @returns {Promise<Object>} Final state when predicate returns true
 */
export async function waitForState(page, predicate, options = {}) {
  const { intervalMs = 3000, timeoutMs = 120000, label = 'condition' } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await detectState(page);
    if (predicate(state)) {
      logger.info('waitForState: condition met', { label, state: state.generationStatus });
      return state;
    }
    logger.debug('waitForState: polling', {
      label,
      status: state.generationStatus,
      progress: state.generationProgress,
      remaining: Math.round((deadline - Date.now()) / 1000) + 's',
    });
    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new Error(`waitForState timeout after ${timeoutMs}ms waiting for: ${label}`);
}
