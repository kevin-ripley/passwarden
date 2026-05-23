const { toCsv, toBitwardenJson } = require('../utils/converter');

const BITWARDEN_ID_FIREFOX = '{446900e4-71c2-419f-a6a7-df9c091e268b}';

function isFirefox() {
  return navigator.userAgent.includes('Firefox');
}

// TODO: Chrome support requires finding Bitwarden's service worker context differently.
// The chrome-extension:// tab approach does not work for MV3 service workers.
async function findBitwardenTabId() {
  const bgUrl = `moz-extension://${BITWARDEN_ID_FIREFOX}/background.html`;
  const tabs = await chrome.tabs.query({ url: bgUrl });
  if (tabs.length === 0) return null;
  return tabs[0].id;
}

async function triggerDownload(content, filename, mimeType) {
  const dataUrl = `data:${mimeType};charset=utf-8,` + encodeURIComponent(content);
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
}

// Self-contained extractor function to be injected via executeScript
function inlineExtractorFn() {
  return (async function extractLogins(bitwardenMain) {
    if (!bitwardenMain) return { status: 'not_found' };
    let userId;
    try {
      if (bitwardenMain.accountService && bitwardenMain.accountService.activeAccount$) {
        userId = await new Promise(function(resolve) {
          var sub = bitwardenMain.accountService.activeAccount$.subscribe(function(account) {
            sub.unsubscribe();
            resolve(account ? account.id : null);
          });
        });
      }
      if (!userId && bitwardenMain.stateService && bitwardenMain.stateService.getUserId) {
        userId = await bitwardenMain.stateService.getUserId();
      }
    } catch (e) {
      return { status: 'locked' };
    }
    if (!userId) return { status: 'locked' };
    try {
      var ciphers = await bitwardenMain.cipherService.getAllDecrypted(userId);
      var logins = ciphers
        .filter(function(c) { return c.type === 1; })
        .map(function(c) {
          return {
            name: c.name || '',
            username: (c.login && c.login.username) || '',
            password: (c.login && c.login.password) || '',
            uri: (c.login && c.login.uris && c.login.uris[0] && c.login.uris[0].uri) || ''
          };
        });
      return { status: 'ok', logins: logins };
    } catch (e) {
      return { status: 'locked' };
    }
  })(window.bitwardenMain);
}

async function handleExport() {
  if (!isFirefox()) {
    return { status: 'unsupported_browser' };
  }

  const tabId = await findBitwardenTabId();
  if (tabId === null) {
    return { status: 'bitwarden_not_found' };
  }

  let extractionResult;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      // func: must receive a function reference, not an IIFE result.
      // inlineExtractorFn is defined above and accesses window.bitwardenMain inside its body.
      func: inlineExtractorFn
    });
    extractionResult = results[0] && results[0].result;
  } catch (e) {
    return { status: 'error', message: e.message };
  }

  if (!extractionResult || extractionResult.status !== 'ok') {
    return extractionResult || { status: 'error' };
  }

  const fakeCiphers = extractionResult.logins.map(function(l) {
    return {
      type: 1,
      name: l.name,
      login: {
        username: l.username,
        password: l.password,
        uris: l.uri ? [{ uri: l.uri }] : []
      }
    };
  });

  const csv = toCsv(fakeCiphers);
  const json = toBitwardenJson(fakeCiphers);

  await triggerDownload(csv, 'passwarden_export.csv', 'text/csv');
  await triggerDownload(json, 'passwarden_export.json', 'application/json');

  return { status: 'ok', count: extractionResult.logins.length };
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'export') {
    handleExport().then(sendResponse);
    return true;
  }
  if (message.action === 'open_bitwarden') {
    const popupUrl = `moz-extension://${BITWARDEN_ID_FIREFOX}/popup/index.html`;
    chrome.tabs.create({ url: popupUrl, active: true });
    sendResponse({ status: 'ok' });
  }
});

module.exports = { handleExport };
