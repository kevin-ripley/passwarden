async function extractLogins(bitwardenMain) {
  if (!bitwardenMain) return { status: 'not_found' };

  let userId;

  try {
    if (bitwardenMain.accountService?.activeAccount$) {
      userId = await new Promise((resolve) => {
        let sub;
        sub = bitwardenMain.accountService.activeAccount$.subscribe(account => {
          if (sub) sub.unsubscribe();
          resolve(account?.id ?? null);
        });
      });
    }
    if (!userId && bitwardenMain.stateService?.getUserId) {
      userId = await bitwardenMain.stateService.getUserId();
    }
  } catch (e) {
    return { status: 'locked' };
  }

  if (!userId) return { status: 'locked' };

  try {
    const ciphers = await bitwardenMain.cipherService.getAllDecrypted(userId);
    const logins = ciphers
      .filter(c => c.type === 1)
      .map(c => ({
        name: c.name || '',
        username: c.login?.username || '',
        password: c.login?.password || '',
        uri: c.login?.uris?.[0]?.uri || ''
      }));
    return { status: 'ok', logins };
  } catch (e) {
    return { status: 'locked' };
  }
}

// Dual-mode: exported for tests, top-level return for executeScript injection
if (typeof module !== 'undefined') {
  module.exports = { extractLogins };
}
// When injected via chrome.scripting.executeScript the file runs inside a
// function wrapper, so the bare `return` below is valid at runtime.  Babel /
// Jest never reaches this branch because `module` is always defined there.
/* istanbul ignore next */
// eslint-disable-next-line no-unreachable
void (typeof module === 'undefined' && extractLogins(window.bitwardenMain));
