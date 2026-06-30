/**
 * wait-generation.js
 * Autonomous generation poller — waits until generation is Ready or Failed.
 * Does NOT call the LLM at any point. Pure deterministic JS polling.
 *
 * This is the key tool for minimizing token consumption:
 * instead of Claude polling flow_status in a loop, this tool runs
 * the entire wait inside a single MCP call and returns only when done.
 */

import { logger } from '../utils/logger.js';
import { getPage } from '../browser/connect.js';
import { detectState, waitForState } from '../browser/state-detector.js';
import { takeScreenshot } from '../utils/screenshots.js';
import { get } from '../utils/config.js';
import { FlowError, ErrorCodes } from '../utils/errors.js';

/**
 * Wait for the current generation to complete.
 * Blocks the MCP call until generation is Ready or Failed.
 *
 * @param {{ timeout_ms?: number, poll_interval_ms?: number, take_screenshot?: boolean }} args
 * @returns {Promise<Object>}
 */
export async function handleWaitGeneration(args = {}) {
  const page = getPage();
  const timeoutMs = args.timeout_ms || get('jobTimeoutMs', 300000);
  const pollIntervalMs = args.poll_interval_ms || get('generationPollIntervalMs', 5000);

  logger.info('wait-generation: starting poll', { timeoutMs, pollIntervalMs });

  // Quick pre-check: is anything actually generating?
  const initialState = await detectState(page);
  if (initialState.generationStatus === 'idle' || initialState.generationStatus === 'ready') {
    const ss = args.take_screenshot !== false ? await takeScreenshot(page, 'wait-gen-initial') : null;
    return {
      status: initialState.generationStatus,
      message: initialState.generationStatus === 'idle'
        ? 'No generation in progress.'
        : 'Generation is already complete.',
      state: initialState,
      screenshot: ss,
    };
  }

  // Use exponential backoff for the first few polls (Queued → Generating transition)
  // then settle into the configured interval
  let pollCount = 0;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollCount < 3 ? 2000 : pollIntervalMs));
    pollCount++;

    const state = await detectState(page);
    logger.debug('wait-generation: poll', {
      count: pollCount,
      status: state.generationStatus,
      progress: state.generationProgress,
      remaining: Math.round((deadline - Date.now()) / 1000) + 's',
    });

    if (state.generationStatus === 'ready') {
      const ss = args.take_screenshot !== false
        ? await takeScreenshot(page, 'wait-gen-complete')
        : null;
      logger.info('wait-generation: generation complete', { polls: pollCount });
      return {
        status: 'ready',
        message: 'Generation completed successfully.',
        polls: pollCount,
        elapsed_ms: pollCount * pollIntervalMs,
        state,
        screenshot: ss,
      };
    }

    if (state.generationStatus === 'failed') {
      const ss = await takeScreenshot(page, 'wait-gen-failed');
      logger.warn('wait-generation: generation failed', { polls: pollCount });
      return {
        status: 'failed',
        message: 'Generation failed. Check the Flow interface for details.',
        polls: pollCount,
        state,
        screenshot: ss,
      };
    }
  }

  // Timeout
  const ss = await takeScreenshot(page, 'wait-gen-timeout');
  throw new FlowError(
    ErrorCodes.GENERATION_TIMEOUT,
    `Generation did not complete within ${timeoutMs}ms (${pollCount} polls)`,
    { polls: pollCount, timeoutMs }
  );
}
