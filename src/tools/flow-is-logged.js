/**
 * flow-is-logged.js
 * MCP tool handler: deterministic login check.
 * Uses session-manager.isLoggedIn() — no full DOM scan.
 */

import { getPage } from '../browser/connect.js';
import { isLoggedIn, isSessionExpired, getSessionInfo } from '../session/session-manager.js';
import { get } from '../utils/config.js';

/**
 * @returns {Promise<Object>}
 */
export async function handleFlowIsLogged(args = {}) {
  const page = getPage();

  const [loginResult, expired, sessionInfo] = await Promise.all([
    isLoggedIn(page),
    isSessionExpired(page),
    Promise.resolve(getSessionInfo()),
  ]);

  const expectedAccount = get('expectedAccount', null);
  let accountMatch = null;

  if (loginResult.loggedIn && loginResult.account && expectedAccount) {
    accountMatch = loginResult.account.toLowerCase().includes(expectedAccount.toLowerCase());
  }

  return {
    logged_in: loginResult.loggedIn,
    session_expired: expired,
    account: loginResult.account,
    expected_account: expectedAccount,
    account_match: accountMatch,
    detection_method: loginResult.method,
    session_file: {
      exists: sessionInfo.exists,
      age_hours: sessionInfo.age_hours || null,
      likely_valid: sessionInfo.likely_valid ?? null,
    },
    recommendation: !loginResult.loggedIn || expired
      ? 'Call flow_connect to re-authenticate.'
      : loginResult.loggedIn && accountMatch === false
        ? 'Wrong Google account. Check chromeProfile config.'
        : 'Session is active.',
  };
}
