/**
 * cancel-generation.js
 * Attempts to cancel an in-progress generation in Google Flow.
 * Uses deterministic selectors for the cancel/stop button.
 */

import { logger } from '../utils/logger.js';
import { getPage } from '../browser/connect.js';
import { detectState } from '../browser/state-detector.js';
import { takeScreenshot } from '../utils/screenshots.js';
import { tAll } from '../utils/locale-adapter.js';

const CANCEL_SELECTORS = [
  'button[aria-label="Cancel"]',
  'button[aria-label="Stop"]',
  'button:has-text("Cancel")',
  'button:has-text("Stop")',
  'button:has-text("Annuler")',
  'button:has-text("Cancelar")',
  '[class*="cancel"] button',
  '[class*="stop"] button',
];

/**
 * Cancel the current generation in progress.
 * @returns {Promise<Object>}
 */
export async function handleCancelGeneration(args = {}) {
  const page = getPage();

  const state = await detectState(page);
  if (!state.generating) {
    return {
      status: 'no_active_generation',
      message: 'No generation is currently in progress.',
      state,
    };
  }

  logger.info('cancel-generation: attempting to cancel', {
    generationStatus: state.generationStatus,
  });

  // Try each cancel selector
  for (const selector of CANCEL_SELECTORS) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await new Promise(r => setTimeout(r, 1500));
        const postState = await detectState(page);
        const ss = await takeScreenshot(page, 'cancel-generation');
        logger.info('cancel-generation: cancelled via', { selector });
        return {
          status: 'cancelled',
          message: 'Generation cancelled.',
          selector_used: selector,
          state: postState,
          screenshot: ss,
        };
      }
    } catch (err) {
      logger.debug('cancel-generation: selector failed', { selector, error: err.message });
    }
  }

  // Fallback: keyboard Escape
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 1000));
  const postState = await detectState(page);
  const ss = await takeScreenshot(page, 'cancel-generation-esc');

  if (!postState.generating) {
    return {
      status: 'cancelled',
      message: 'Generation cancelled via Escape key.',
      state: postState,
      screenshot: ss,
    };
  }

  return {
    status: 'cancel_failed',
    message: 'Could not find a cancel button. Generation may still be running.',
    state: postState,
    screenshot: ss,
  };
}
