async function extractLogins(bitwardenMain) {
  if (!bitwardenMain) return { status: 'not_found' };

  let userId;

  try {
    if (bitwardenMain.accountService?.activeAccount$) {
      userId = await new Promise((resolve) => {
        const sub = bitwardenMain.accountService.activeAccount$.subscribe(account => {
          resolve(account?.id ?? null);
        });
        sub.unsubscribe();
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

// Dual-mode export:
// - In Node/Jest (module is defined): export for unit tests.
// - In executeScript func: injection (module is undefined): executeScript wraps
//   the file as a function body, so the return sends the Promise back to the caller.
if (typeof module !== 'undefined') {
  module.exports = { extractLogins };
} else {
  /* istanbul ignore next */
  return extractLogins(window.bitwardenMain);
}
