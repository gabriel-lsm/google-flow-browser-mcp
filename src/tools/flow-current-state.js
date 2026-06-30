/**
 * flow-current-state.js
 * MCP tool handler: returns the current UI state without any DOM scan.
 * Uses state-detector.js for a single evaluate() call.
 */

import { getPage } from '../browser/connect.js';
import { detectState } from '../browser/state-detector.js';
import { getSessionInfo } from '../session/session-manager.js';
import { cacheStats } from '../browser/selector-cache.js';
import { jobQueue } from '../queue/job-queue.js';
import { takeScreenshot } from '../utils/screenshots.js';

/**
 * @param {{ include_screenshot?: boolean, include_cache_stats?: boolean }} args
 */
export async function handleFlowCurrentState(args = {}) {
  const page = getPage();
  const state = await detectState(page);
  const sessionInfo = getSessionInfo();
  const activeJob = jobQueue.getStatus(1);

  const result = {
    ui: state,
    session: {
      file_exists: sessionInfo.exists,
      age_hours: sessionInfo.age_hours || null,
      likely_valid: sessionInfo.likely_valid ?? null,
    },
    active_job: activeJob.active || null,
    pending_jobs: activeJob.pending?.length || 0,
  };

  if (args.include_cache_stats) {
    result.selector_cache = cacheStats();
  }

  if (args.include_screenshot) {
    result.screenshot = await takeScreenshot(page, 'current-state');
  }

  return result;
}
