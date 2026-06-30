/**
 * selector-cache.js
 * In-memory cache of confirmed Playwright selectors.
 * Eliminates repeated isVisible() loops across tool calls.
 *
 * Cache is scoped per "context key" (e.g., URL path prefix like "/project/").
 * Cache is invalidated automatically when the URL context changes.
 */

import { logger } from '../utils/logger.js';

/** @type {Map<string, { selector: string, verified: boolean, timestamp: number }>} */
const cache = new Map();

/** Tracks the URL context the cache was built for */
let _contextUrl = '';

const TTL_MS = 5 * 60 * 1000; // 5 minutes — React SPA refs change on re-render

/**
 * Extract the "context key" from a URL (path prefix up to project UUID).
 * /project/abc123/edit → '/project'
 * /project/abc123      → '/project'
 * /tools               → '/tools'
 */
function urlContext(url) {
  try {
    const path = new URL(url).pathname;
    if (path.includes('/project/')) return '/project';
    const segments = path.split('/').filter(Boolean);
    return '/' + (segments[0] || '');
  } catch {
    return url.substring(0, 40);
  }
}

/**
 * Set the current page URL. If context changed, invalidate cache.
 * @param {string} url
 */
export function updateUrlContext(url) {
  const ctx = urlContext(url);
  if (ctx !== _contextUrl) {
    logger.debug('SelectorCache: context changed, invalidating', { old: _contextUrl, new: ctx });
    cache.clear();
    _contextUrl = ctx;
  }
}

/**
 * Store a confirmed selector for a semantic key.
 * @param {string} key - Semantic key (e.g., 'prompt_input', 'generate_btn')
 * @param {string} selector - The Playwright selector string that worked
 */
export function cacheSelector(key, selector) {
  cache.set(key, { selector, verified: true, timestamp: Date.now() });
  logger.debug('SelectorCache: cached', { key, selector });
}

/**
 * Get a cached selector by key.
 * Returns null if not cached or expired.
 * @param {string} key
 * @returns {string|null}
 */
export function getCachedSelector(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(key);
    logger.debug('SelectorCache: expired', { key });
    return null;
  }
  return entry.selector;
}

/**
 * High-level helper: try cached selector first, then probe candidates,
 * cache the winner, and return the Playwright locator.
 *
 * @param {import('playwright').Page} page
 * @param {string} key - Semantic key (e.g., 'prompt_input')
 * @param {import('playwright').Locator[]} candidates - Ordered list of locators to try
 * @returns {Promise<import('playwright').Locator|null>}
 */
export async function resolveLocator(page, key, candidates) {
  // Update context from current URL
  updateUrlContext(page.url());

  // Try cache first
  const cached = getCachedSelector(key);
  if (cached) {
    const loc = page.locator(cached).first();
    if (await loc.isVisible().catch(() => false)) {
      logger.debug('SelectorCache: hit', { key, selector: cached });
      return loc;
    }
    // Cache miss (DOM changed), invalidate this key
    cache.delete(key);
    logger.debug('SelectorCache: stale, re-probing', { key });
  }

  // Probe candidates
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      // Extract selector string from the locator if possible
      const selectorStr = candidate.toString();
      cacheSelector(key, selectorStr);
      return candidate;
    }
  }

  return null;
}

/**
 * Invalidate a specific key (e.g., after a DOM mutation).
 * @param {string} key
 */
export function invalidate(key) {
  cache.delete(key);
}

/**
 * Invalidate entire cache.
 */
export function clearAll() {
  cache.clear();
  logger.debug('SelectorCache: cleared all');
}

/**
 * Returns cache stats for debugging.
 */
export function cacheStats() {
  return {
    size: cache.size,
    contextUrl: _contextUrl,
    keys: [...cache.keys()],
  };
}
