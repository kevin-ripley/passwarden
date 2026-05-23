# PassWarden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Firefox/Chrome browser extension that exports Bitwarden login credentials (name, username, password, URL) as both CSV and Bitwarden-importable JSON in a single click.

**Architecture:** The extension popup sends an export request to a background service worker, which injects an extractor function into Bitwarden's background page to call `getAllDecrypted()` with an auto-detected userId, then converts the results and triggers two file downloads. Vault-locked and Bitwarden-not-found states are surfaced to the user via the popup.

**Tech Stack:** Vanilla JavaScript (ES2020), Chrome Extensions Manifest V3, Jest + jest-webextensions-mock for testing, Node.js build scripts for packaging.

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dev dependencies, Jest config, build scripts |
| `manifest.json` | MV3 extension manifest — permissions, background worker, popup |
| `utils/converter.js` | Pure functions: cipher array → CSV string, cipher array → Bitwarden JSON string |
| `scripts/extractor.js` | Self-contained function injected into Bitwarden's background page — detects userId, calls `getAllDecrypted`, filters to logins |
| `background/background.js` | Service worker — handles popup messages, injects extractor, triggers downloads |
| `popup/popup.html` | Extension toolbar popup — single button + status area |
| `popup/popup.js` | Popup state machine — idle, loading, success, locked, error |
| `icons/generate.js` | Node script that generates 16/48/128px PNG icons |
| `tests/converter.test.js` | Unit tests for converter (no browser APIs) |
| `tests/extractor.test.js` | Unit tests for extractor logic (mocked `window.bitwardenMain`) |
| `tests/background.test.js` | Unit tests for background orchestration (mocked chrome APIs) |
| `tests/popup.test.js` | Unit tests for popup state transitions |
| `tests/integration/pipeline.test.js` | End-to-end pipeline with fully stubbed `bitwardenMain` |
| `build/package-firefox.js` | Node script that produces `passwarden-firefox-v1.0.0.xpi` |
| `build/package-chrome.js` | Node script that produces `passwarden-chrome-v1.0.0.zip` |
| `README.md` | Install instructions for Firefox and Chrome |

---

## Known Bitwarden Extension IDs

- **Firefox:** `{446900e4-71c2-419f-a6a7-df9c091e268b}`
- **Chrome:** `nngceckbapebfimnlniiiahkandclblb`

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `jest.config.js`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p utils scripts background popup icons tests/integration build
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "passwarden",
  "version": "1.0.0",
  "description": "Export Bitwarden vault credentials from Firefox",
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "build:firefox": "node build/package-firefox.js",
    "build:chrome": "node build/package-chrome.js"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "jest-webextensions-mock": "^3.8.9",
    "archiver": "^6.0.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Create `jest.config.js`**

```javascript
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['jest-webextensions-mock'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['utils/**/*.js', 'scripts/**/*.js', 'background/**/*.js', 'popup/**/*.js']
};
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
*.xpi
*.zip
*.crx
coverage/
```

- [ ] **Step 6: Verify Jest runs (no tests yet)**

```bash
npm test
```

Expected output: `No tests found, exiting with code 1` — this is fine, confirms Jest is wired up.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json jest.config.js .gitignore
git commit -m "chore: project scaffold with Jest and jest-webextensions-mock"
```

---

## Task 2: Converter (TDD)

**Files:**
- Create: `tests/converter.test.js`
- Create: `utils/converter.js`

- [ ] **Step 1: Write failing tests**

Create `tests/converter.test.js`:

```javascript
const { toCsv, toBitwardenJson } = require('../utils/converter');

const makeCipher = (overrides = {}) => ({
  type: 1,
  name: 'GitHub',
  login: {
    username: 'user@example.com',
    password: 'abc123',
    uris: [{ uri: 'https://github.com' }]
  },
  ...overrides
});

describe('toCsv', () => {
  test('outputs header row', () => {
    const csv = toCsv([]);
    expect(csv.split('\n')[0]).toBe('name,username,password,url');
  });

  test('converts a single login', () => {
    const csv = toCsv([makeCipher()]);
    const rows = csv.split('\n');
    expect(rows[1]).toBe('GitHub,user@example.com,abc123,https://github.com');
  });

  test('filters out non-login types', () => {
    const note = makeCipher({ type: 2 });
    const csv = toCsv([note]);
    const rows = csv.split('\n').filter(Boolean);
    expect(rows.length).toBe(1); // header only
  });

  test('handles missing login fields gracefully', () => {
    const cipher = { type: 1, name: 'No Login', login: null };
    expect(() => toCsv([cipher])).not.toThrow();
    const csv = toCsv([cipher]);
    expect(csv).toContain('No Login');
  });

  test('handles missing URIs', () => {
    const cipher = makeCipher({ login: { username: 'u', password: 'p', uris: [] } });
    const csv = toCsv([cipher]);
    expect(csv.split('\n')[1]).toBe('GitHub,u,p,');
  });

  test('escapes commas in fields', () => {
    const cipher = makeCipher({ name: 'My, Site' });
    const csv = toCsv([cipher]);
    expect(csv).toContain('"My, Site"');
  });

  test('escapes double quotes in fields', () => {
    const cipher = makeCipher({ name: 'Say "Hello"' });
    const csv = toCsv([cipher]);
    expect(csv).toContain('"Say ""Hello"""');
  });

  test('handles empty vault', () => {
    const csv = toCsv([]);
    expect(csv).toBe('name,username,password,url');
  });

  test('handles 1000 logins without error', () => {
    const ciphers = Array.from({ length: 1000 }, (_, i) =>
      makeCipher({ name: `Site ${i}`, login: { username: `u${i}`, password: `p${i}`, uris: [{ uri: `https://site${i}.com` }] } })
    );
    expect(() => toCsv(ciphers)).not.toThrow();
    const rows = toCsv(ciphers).split('\n');
    expect(rows.length).toBe(1001); // header + 1000 rows
  });
});

describe('toBitwardenJson', () => {
  test('returns valid JSON with encrypted: false', () => {
    const json = toBitwardenJson([]);
    const parsed = JSON.parse(json);
    expect(parsed.encrypted).toBe(false);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  test('converts a single login', () => {
    const json = JSON.parse(toBitwardenJson([makeCipher()]));
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toEqual({
      type: 1,
      name: 'GitHub',
      login: {
        username: 'user@example.com',
        password: 'abc123',
        uris: [{ match: null, uri: 'https://github.com' }]
      }
    });
  });

  test('filters out non-login types', () => {
    const json = JSON.parse(toBitwardenJson([makeCipher({ type: 2 })]));
    expect(json.items).toHaveLength(0);
  });

  test('handles null login', () => {
    const cipher = { type: 1, name: 'Broken', login: null };
    expect(() => toBitwardenJson([cipher])).not.toThrow();
    const parsed = JSON.parse(toBitwardenJson([cipher]));
    expect(parsed.items[0].login.username).toBe('');
  });

  test('outputs empty uris array when no URIs', () => {
    const cipher = makeCipher({ login: { username: 'u', password: 'p', uris: null } });
    const parsed = JSON.parse(toBitwardenJson([cipher]));
    expect(parsed.items[0].login.uris).toEqual([]);
  });

  test('uses only first URI when multiple exist', () => {
    const cipher = makeCipher({
      login: { username: 'u', password: 'p', uris: [{ uri: 'https://a.com' }, { uri: 'https://b.com' }] }
    });
    const parsed = JSON.parse(toBitwardenJson([cipher]));
    expect(parsed.items[0].login.uris).toHaveLength(1);
    expect(parsed.items[0].login.uris[0].uri).toBe('https://a.com');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/converter.test.js
```

Expected: `Cannot find module '../utils/converter'`

- [ ] **Step 3: Implement `utils/converter.js`**

```javascript
function escapeCsvField(value) {
  const str = String(value == null ? '' : value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function normalizeLogin(cipher) {
  return {
    name: cipher.name || '',
    username: cipher.login?.username || '',
    password: cipher.login?.password || '',
    uri: cipher.login?.uris?.[0]?.uri || ''
  };
}

function toCsv(ciphers) {
  const logins = ciphers.filter(c => c.type === 1).map(normalizeLogin);
  const header = 'name,username,password,url';
  const rows = logins.map(l =>
    [l.name, l.username, l.password, l.uri].map(escapeCsvField).join(',')
  );
  return [header, ...rows].join('\n');
}

function toBitwardenJson(ciphers) {
  const logins = ciphers.filter(c => c.type === 1).map(normalizeLogin);
  const items = logins.map(l => ({
    type: 1,
    name: l.name,
    login: {
      username: l.username,
      password: l.password,
      uris: l.uri ? [{ match: null, uri: l.uri }] : []
    }
  }));
  return JSON.stringify({ encrypted: false, items }, null, 2);
}

module.exports = { toCsv, toBitwardenJson, normalizeLogin };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test tests/converter.test.js
```

Expected: all tests pass, green output.

- [ ] **Step 5: Commit**

```bash
git add utils/converter.js tests/converter.test.js
git commit -m "feat: converter — cipher array to CSV and Bitwarden JSON (TDD)"
```

---

## Task 3: Extractor Logic (TDD)

**Files:**
- Create: `tests/extractor.test.js`
- Create: `scripts/extractor.js`

- [ ] **Step 1: Write failing tests**

Create `tests/extractor.test.js`:

```javascript
const { extractLogins } = require('../scripts/extractor');

function makeBitwardenMain({ userId = 'test-uuid', ciphers = [], locked = false } = {}) {
  return {
    accountService: {
      activeAccount$: {
        subscribe: (cb) => {
          cb(locked ? null : { id: userId });
          return { unsubscribe: jest.fn() };
        }
      }
    },
    stateService: {
      getUserId: jest.fn().mockResolvedValue(locked ? null : userId)
    },
    cipherService: {
      getAllDecrypted: jest.fn().mockResolvedValue(ciphers)
    }
  };
}

describe('extractLogins', () => {
  test('returns not_found when bitwardenMain is absent', async () => {
    const result = await extractLogins(undefined);
    expect(result.status).toBe('not_found');
  });

  test('returns locked when no active userId', async () => {
    const bw = makeBitwardenMain({ locked: true });
    const result = await extractLogins(bw);
    expect(result.status).toBe('locked');
  });

  test('returns ok with login array on success', async () => {
    const ciphers = [{
      type: 1,
      name: 'GitHub',
      login: { username: 'user@example.com', password: 'secret', uris: [{ uri: 'https://github.com' }] }
    }];
    const bw = makeBitwardenMain({ ciphers });
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
    expect(result.logins).toHaveLength(1);
    expect(result.logins[0]).toEqual({
      name: 'GitHub',
      username: 'user@example.com',
      password: 'secret',
      uri: 'https://github.com'
    });
  });

  test('filters out non-login cipher types', async () => {
    const ciphers = [
      { type: 1, name: 'Login', login: { username: 'u', password: 'p', uris: [] } },
      { type: 2, name: 'Note', login: null },
      { type: 3, name: 'Card', login: null }
    ];
    const bw = makeBitwardenMain({ ciphers });
    const result = await extractLogins(bw);
    expect(result.logins).toHaveLength(1);
    expect(result.logins[0].name).toBe('Login');
  });

  test('uses stateService fallback when accountService absent', async () => {
    const ciphers = [{ type: 1, name: 'Test', login: { username: 'u', password: 'p', uris: [] } }];
    const bw = makeBitwardenMain({ ciphers });
    delete bw.accountService;
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
  });

  test('returns locked when getAllDecrypted throws', async () => {
    const bw = makeBitwardenMain();
    bw.cipherService.getAllDecrypted.mockRejectedValue(new Error('vault locked'));
    const result = await extractLogins(bw);
    expect(result.status).toBe('locked');
  });

  test('handles missing login fields on ciphers', async () => {
    const ciphers = [{ type: 1, name: 'Broken', login: null }];
    const bw = makeBitwardenMain({ ciphers });
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
    expect(result.logins[0]).toEqual({ name: 'Broken', username: '', password: '', uri: '' });
  });

  test('returns ok with empty logins on empty vault', async () => {
    const bw = makeBitwardenMain({ ciphers: [] });
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
    expect(result.logins).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/extractor.test.js
```

Expected: `Cannot find module '../scripts/extractor'`

- [ ] **Step 3: Implement `scripts/extractor.js`**

```javascript
async function extractLogins(bitwardenMain) {
  if (!bitwardenMain) return { status: 'not_found' };

  let userId;

  try {
    if (bitwardenMain.accountService?.activeAccount$) {
      userId = await new Promise((resolve) => {
        const sub = bitwardenMain.accountService.activeAccount$.subscribe(account => {
          sub.unsubscribe();
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
} else {
  return extractLogins(window.bitwardenMain);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test tests/extractor.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/extractor.js tests/extractor.test.js
git commit -m "feat: extractor — auto-detect userId and call getAllDecrypted (TDD)"
```

---

## Task 4: Background Service Worker (TDD)

**Files:**
- Create: `tests/background.test.js`
- Create: `background/background.js`

- [ ] **Step 1: Write failing tests**

Create `tests/background.test.js`:

```javascript
// jest-webextensions-mock sets up chrome.* APIs globally
// We need to import background.js after setting up mocks

const BITWARDEN_ID_FIREFOX = '{446900e4-71c2-419f-a6a7-df9c091e268b}';

beforeEach(() => {
  jest.resetModules();
  // Reset chrome mocks between tests
  chrome.scripting.executeScript.mockReset();
  chrome.tabs.query.mockReset();
  chrome.downloads.download.mockReset();
});

function loadBackground() {
  return require('../background/background');
}

describe('handleExport', () => {
  test('returns unsupported_browser on non-Firefox user agent', async () => {
    // Simulate Chrome UA
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 Chrome/124.0',
      configurable: true
    });
    const { handleExport } = loadBackground();
    const result = await handleExport();
    expect(result.status).toBe('unsupported_browser');
  });

  test('returns bitwarden_not_found when no Bitwarden tab exists', async () => {
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 Firefox/124.0',
      configurable: true
    });
    chrome.tabs.query.mockResolvedValue([]);
    const { handleExport } = loadBackground();
    const result = await handleExport();
    expect(result.status).toBe('bitwarden_not_found');
  });

  test('returns locked when extractor reports locked', async () => {
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 Firefox/124.0',
      configurable: true
    });
    chrome.tabs.query.mockResolvedValue([{ id: 42 }]);
    chrome.scripting.executeScript.mockResolvedValue([{ result: { status: 'locked' } }]);
    const { handleExport } = loadBackground();
    const result = await handleExport();
    expect(result.status).toBe('locked');
  });

  test('triggers two downloads and returns ok on success', async () => {
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 Firefox/124.0',
      configurable: true
    });
    chrome.tabs.query.mockResolvedValue([{ id: 42 }]);
    chrome.scripting.executeScript.mockResolvedValue([{
      result: {
        status: 'ok',
        logins: [{
          name: 'GitHub',
          username: 'user@example.com',
          password: 'secret',
          uri: 'https://github.com'
        }]
      }
    }]);
    chrome.downloads.download.mockResolvedValue(1);
    const { handleExport } = loadBackground();
    const result = await handleExport();
    expect(result.status).toBe('ok');
    expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
    const calls = chrome.downloads.download.mock.calls;
    expect(calls[0][0].filename).toBe('passwarden_export.csv');
    expect(calls[1][0].filename).toBe('passwarden_export.json');
  });

  test('returns error when executeScript throws', async () => {
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 Firefox/124.0',
      configurable: true
    });
    chrome.tabs.query.mockResolvedValue([{ id: 42 }]);
    chrome.scripting.executeScript.mockRejectedValue(new Error('injection failed'));
    const { handleExport } = loadBackground();
    const result = await handleExport();
    expect(result.status).toBe('error');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/background.test.js
```

Expected: `Cannot find module '../background/background'`

- [ ] **Step 3: Implement `background/background.js`**

```javascript
const { toCsv, toBitwardenJson } = require('../utils/converter');
const { extractLogins } = require('../scripts/extractor');

const BITWARDEN_ID_FIREFOX = '{446900e4-71c2-419f-a6a7-df9c091e268b}';

function isFirefox() {
  return navigator.userAgent.includes('Firefox');
}

async function findBitwardenTabId() {
  const bgUrl = `moz-extension://${BITWARDEN_ID_FIREFOX}/background.html`;
  const tabs = await chrome.tabs.query({ url: bgUrl });
  if (tabs.length === 0) return null;
  return tabs[0].id;
}

async function triggerDownload(content, filename, mimeType) {
  const dataUrl = `data:${mimeType};charset=utf-8,` + encodeURIComponent(content);
  await chrome.downloads.download({ url: dataUrl, filename });
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
      func: (function() {
        // Inline extractor — must be self-contained (no external references)
        return (async function extractLogins(bitwardenMain) {
          if (!bitwardenMain) return { status: 'not_found' };
          let userId;
          try {
            if (bitwardenMain.accountService?.activeAccount$) {
              userId = await new Promise((resolve) => {
                const sub = bitwardenMain.accountService.activeAccount$.subscribe(account => {
                  sub.unsubscribe();
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
        })(window.bitwardenMain);
      })
    });
    extractionResult = results[0]?.result;
  } catch (e) {
    return { status: 'error', message: e.message };
  }

  if (!extractionResult || extractionResult.status !== 'ok') {
    return extractionResult || { status: 'error' };
  }

  const fakeCiphers = extractionResult.logins.map(l => ({
    type: 1,
    name: l.name,
    login: { username: l.username, password: l.password, uris: l.uri ? [{ uri: l.uri }] : [] }
  }));

  const csv = toCsv(fakeCiphers);
  const json = toBitwardenJson(fakeCiphers);

  await triggerDownload(csv, 'passwarden_export.csv', 'text/csv');
  await triggerDownload(json, 'passwarden_export.json', 'application/json');

  return { status: 'ok', count: extractionResult.logins.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test tests/background.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add background/background.js tests/background.test.js
git commit -m "feat: background service worker — inject extractor, convert, download (TDD)"
```

---

## Task 5: Popup UI (TDD)

**Files:**
- Create: `tests/popup.test.js`
- Create: `popup/popup.html`
- Create: `popup/popup.js`

- [ ] **Step 1: Write failing tests**

Create `tests/popup.test.js`:

```javascript
/**
 * @jest-environment jsdom
 */

// Set up DOM before requiring popup.js
document.body.innerHTML = `
  <button id="exportBtn">Export Vault</button>
  <div id="status" class="hidden"></div>
  <button id="unlockBtn" class="hidden">Unlock Bitwarden</button>
`;

// Mock chrome.runtime.sendMessage
chrome.runtime.sendMessage = jest.fn();

// Import popup state logic (not popup.js itself — extract pure state functions)
const { applyState } = require('../popup/popup');

describe('applyState', () => {
  beforeEach(() => {
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('exportBtn').textContent = 'Export Vault';
    document.getElementById('status').className = 'hidden';
    document.getElementById('status').textContent = '';
    document.getElementById('unlockBtn').className = 'hidden';
  });

  test('idle state shows export button enabled', () => {
    applyState({ type: 'idle' });
    expect(document.getElementById('exportBtn').disabled).toBe(false);
    expect(document.getElementById('status').className).toContain('hidden');
  });

  test('loading state disables button and shows spinner text', () => {
    applyState({ type: 'loading' });
    expect(document.getElementById('exportBtn').disabled).toBe(true);
    expect(document.getElementById('exportBtn').textContent).toBe('Exporting...');
  });

  test('success state shows count message', () => {
    applyState({ type: 'success', count: 42 });
    const status = document.getElementById('status');
    expect(status.className).not.toContain('hidden');
    expect(status.textContent).toContain('42');
    expect(document.getElementById('exportBtn').disabled).toBe(false);
  });

  test('locked state shows locked message and unlock button', () => {
    applyState({ type: 'locked' });
    const status = document.getElementById('status');
    expect(status.textContent).toContain('locked');
    expect(document.getElementById('unlockBtn').className).not.toContain('hidden');
  });

  test('not_found state shows install message', () => {
    applyState({ type: 'not_found' });
    const status = document.getElementById('status');
    expect(status.textContent).toContain('not found');
  });

  test('unsupported_browser state shows chrome message', () => {
    applyState({ type: 'unsupported_browser' });
    const status = document.getElementById('status');
    expect(status.textContent).toContain('not supported');
  });

  test('error state shows generic error message', () => {
    applyState({ type: 'error' });
    const status = document.getElementById('status');
    expect(status.textContent).toContain('failed');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/popup.test.js
```

Expected: `Cannot find module '../popup/popup'`

- [ ] **Step 3: Create `popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PassWarden</title>
  <style>
    body { font-family: system-ui, sans-serif; width: 280px; padding: 16px; margin: 0; }
    h1 { font-size: 16px; margin: 0 0 12px; }
    button { width: 100%; padding: 8px 12px; font-size: 14px; cursor: pointer; border-radius: 4px; border: none; }
    #exportBtn { background: #175DDC; color: white; }
    #exportBtn:disabled { background: #aaa; cursor: not-allowed; }
    #unlockBtn { background: #f0ad4e; color: white; margin-top: 8px; }
    #status { margin-top: 10px; font-size: 13px; padding: 8px; border-radius: 4px; }
    #status.hidden { display: none; }
    #status.success { background: #d4edda; color: #155724; }
    #status.error { background: #f8d7da; color: #721c24; }
    #unlockBtn.hidden { display: none; }
  </style>
</head>
<body>
  <h1>PassWarden</h1>
  <button id="exportBtn">Export Vault</button>
  <div id="status" class="hidden"></div>
  <button id="unlockBtn" class="hidden">Unlock Bitwarden</button>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `popup/popup.js`**

```javascript
function applyState(state) {
  const exportBtn = document.getElementById('exportBtn');
  const status = document.getElementById('status');
  const unlockBtn = document.getElementById('unlockBtn');

  exportBtn.disabled = false;
  exportBtn.textContent = 'Export Vault';
  unlockBtn.className = 'hidden';
  status.className = 'hidden';
  status.textContent = '';

  switch (state.type) {
    case 'idle':
      break;

    case 'loading':
      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting...';
      break;

    case 'success':
      status.className = 'success';
      status.textContent = `✓ Export complete — ${state.count} logins downloaded as CSV and JSON.`;
      break;

    case 'locked':
      status.className = 'error';
      status.textContent = 'Your Bitwarden vault is locked.';
      unlockBtn.className = '';
      break;

    case 'not_found':
      status.className = 'error';
      status.textContent = 'Bitwarden extension not found. Please install it first.';
      break;

    case 'unsupported_browser':
      status.className = 'error';
      status.textContent = 'Automatic export is not supported on this browser. See README for the manual DevTools method.';
      break;

    case 'error':
    default:
      status.className = 'error';
      status.textContent = 'Export failed. Make sure Bitwarden is unlocked and try again.';
      break;
  }
}

// Wire up buttons when running in the browser (not in tests)
if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && typeof document !== 'undefined') {
  document.getElementById('exportBtn').addEventListener('click', () => {
    applyState({ type: 'loading' });
    chrome.runtime.sendMessage({ action: 'export' }, (response) => {
      if (response.status === 'ok') {
        applyState({ type: 'success', count: response.count });
      } else {
        applyState({ type: response.status });
      }
    });
  });

  document.getElementById('unlockBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'open_bitwarden' });
  });
}

if (typeof module !== 'undefined') {
  module.exports = { applyState };
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test tests/popup.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add popup/popup.html popup/popup.js tests/popup.test.js
git commit -m "feat: popup UI with state machine for idle/loading/success/locked/error (TDD)"
```

---

## Task 6: Manifest + Icons

**Files:**
- Create: `manifest.json`
- Create: `icons/generate.js`
- Create: `icons/16.png`, `icons/48.png`, `icons/128.png`

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "PassWarden",
  "version": "1.0.0",
  "description": "Export your Bitwarden logins as CSV and JSON with one click.",
  "permissions": [
    "scripting",
    "tabs",
    "downloads"
  ],
  "host_permissions": [
    "moz-extension://*/*"
  ],
  "background": {
    "scripts": ["background/background.js"],
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/16.png",
      "48": "icons/48.png",
      "128": "icons/128.png"
    }
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "passwarden@passwarden.dev",
      "strict_min_version": "109.0"
    }
  }
}
```

- [ ] **Step 2: Create `icons/generate.js`**

```javascript
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// Requires: npm install canvas
// Generates simple colored shield icons for PassWarden

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background circle
  ctx.fillStyle = '#175DDC';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // Letter P
  ctx.fillStyle = 'white';
  ctx.font = `bold ${Math.floor(size * 0.55)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', size / 2, size / 2 + size * 0.02);

  return canvas.toBuffer('image/png');
}

[16, 48, 128].forEach(size => {
  const buf = generateIcon(size);
  const outPath = path.join(__dirname, `${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated icons/${size}.png`);
});
```

- [ ] **Step 3: Install canvas and generate icons**

```bash
npm install --save-dev canvas
node icons/generate.js
```

Expected: `Generated icons/16.png`, `icons/48.png`, `icons/128.png`

If `canvas` fails to install (native dependency), use this fallback — copy any 16/48/128px PNG files into the `icons/` directory manually and skip this step.

- [ ] **Step 4: Verify extension loads in Firefox**

1. Open Firefox → `about:debugging` → This Firefox → Load Temporary Add-on
2. Select `manifest.json` from the project root
3. Expected: PassWarden icon appears in Firefox toolbar with no errors in the console

- [ ] **Step 5: Commit**

```bash
git add manifest.json icons/
git commit -m "feat: manifest.json and extension icons"
```

---

## Task 7: Integration Test

**Files:**
- Create: `tests/integration/pipeline.test.js`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/pipeline.test.js`:

```javascript
const { toCsv, toBitwardenJson } = require('../../utils/converter');
const { extractLogins } = require('../../scripts/extractor');

// Full pipeline: stubbed bitwardenMain → extractLogins → convert → verify output
describe('Full export pipeline', () => {
  const mockCiphers = [
    {
      type: 1,
      name: 'GitHub',
      login: { username: 'dev@example.com', password: 'gh-secret', uris: [{ uri: 'https://github.com' }] }
    },
    {
      type: 1,
      name: 'Gmail',
      login: { username: 'me@gmail.com', password: 'gm-secret', uris: [{ uri: 'https://mail.google.com' }] }
    },
    {
      type: 2,
      name: 'SSH Key Note',
      login: null
    }
  ];

  function makeBitwardenMain() {
    return {
      accountService: {
        activeAccount$: {
          subscribe: (cb) => {
            cb({ id: 'real-uuid-1234' });
            return { unsubscribe: jest.fn() };
          }
        }
      },
      cipherService: {
        getAllDecrypted: jest.fn().mockResolvedValue(mockCiphers)
      }
    };
  }

  test('extracts only logins, converts to valid CSV', async () => {
    const bw = makeBitwardenMain();
    const result = await extractLogins(bw);

    expect(result.status).toBe('ok');
    expect(result.logins).toHaveLength(2); // excludes the type:2 note

    const fakeCiphers = result.logins.map(l => ({
      type: 1, name: l.name,
      login: { username: l.username, password: l.password, uris: l.uri ? [{ uri: l.uri }] : [] }
    }));

    const csv = toCsv(fakeCiphers);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('name,username,password,url');
    expect(rows[1]).toBe('GitHub,dev@example.com,gh-secret,https://github.com');
    expect(rows[2]).toBe('Gmail,me@gmail.com,gm-secret,https://mail.google.com');
  });

  test('extracts only logins, converts to valid Bitwarden JSON', async () => {
    const bw = makeBitwardenMain();
    const result = await extractLogins(bw);

    const fakeCiphers = result.logins.map(l => ({
      type: 1, name: l.name,
      login: { username: l.username, password: l.password, uris: l.uri ? [{ uri: l.uri }] : [] }
    }));

    const json = JSON.parse(toBitwardenJson(fakeCiphers));
    expect(json.encrypted).toBe(false);
    expect(json.items).toHaveLength(2);
    expect(json.items[0].name).toBe('GitHub');
    expect(json.items[0].login.username).toBe('dev@example.com');
    expect(json.items[1].name).toBe('Gmail');
  });

  test('locked vault produces no output', async () => {
    const bw = {
      accountService: {
        activeAccount$: {
          subscribe: (cb) => { cb(null); return { unsubscribe: jest.fn() }; }
        }
      },
      stateService: { getUserId: jest.fn().mockResolvedValue(null) },
      cipherService: { getAllDecrypted: jest.fn() }
    };
    const result = await extractLogins(bw);
    expect(result.status).toBe('locked');
    expect(bw.cipherService.getAllDecrypted).not.toHaveBeenCalled();
  });

  test('handles 1000 logins end-to-end', async () => {
    const bigVault = Array.from({ length: 1000 }, (_, i) => ({
      type: 1,
      name: `Site ${i}`,
      login: { username: `u${i}@test.com`, password: `pass${i}`, uris: [{ uri: `https://site${i}.com` }] }
    }));
    const bw = {
      accountService: { activeAccount$: { subscribe: cb => { cb({ id: 'uid' }); return { unsubscribe: jest.fn() }; } } },
      cipherService: { getAllDecrypted: jest.fn().mockResolvedValue(bigVault) }
    };
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
    expect(result.logins).toHaveLength(1000);

    const fakeCiphers = result.logins.map(l => ({
      type: 1, name: l.name,
      login: { username: l.username, password: l.password, uris: l.uri ? [{ uri: l.uri }] : [] }
    }));
    expect(() => toCsv(fakeCiphers)).not.toThrow();
    expect(() => toBitwardenJson(fakeCiphers)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
npm test tests/integration/pipeline.test.js
```

Expected: all 4 tests pass.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests across all files pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/pipeline.test.js
git commit -m "test: integration pipeline — extraction + conversion end-to-end"
```

---

## Task 8: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite `README.md`**

```markdown
# PassWarden

Export your Bitwarden logins (username, password, URL) from Firefox as a CSV and
Bitwarden-importable JSON file — with one click.

**Requirements:** Bitwarden extension installed in Firefox, vault must be unlocked.

---

## Install — Firefox

1. Go to the [Releases](https://github.com/kevin-ripley/passwarden/releases) page
2. Download `passwarden-firefox-v1.0.0.xpi`
3. Open Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on**
4. Select the downloaded `.xpi` file
5. The PassWarden icon appears in your toolbar

## Install — Chrome

1. Go to the [Releases](https://github.com/kevin-ripley/passwarden/releases) page
2. Download `passwarden-chrome-v1.0.0.zip` and unzip it
3. Open Chrome → Settings → **Extensions** → enable **Developer mode** (top right)
4. Click **Load unpacked** → select the unzipped folder

> **Note:** Chrome support is experimental. If automatic export fails, use the
> manual DevTools method described below.

---

## Usage

1. Make sure your Bitwarden extension is **unlocked**
2. Click the **PassWarden** toolbar icon
3. Click **Export Vault**
4. Two files download automatically:
   - `passwarden_export.csv` — readable in any spreadsheet app
   - `passwarden_export.json` — import directly into Bitwarden via
     Settings → Import Data → Bitwarden (json)

If your vault is locked, click **Unlock Bitwarden**, unlock it, then click Export again.

---

## Manual DevTools Method (Chrome fallback)

1. Open Firefox/Chrome → navigate to `about:debugging` (Firefox) or `chrome://extensions` (Chrome)
2. Find the Bitwarden extension → click **Inspect** (Firefox) or **background page** (Chrome)
3. In the DevTools console, paste and run the contents of `scripts/extractor.js`
4. The vault data will be logged to the console

---

## How it works

PassWarden injects a script into Bitwarden's already-running background page and calls
`cipherService.getAllDecrypted()` — Bitwarden's own internal decryption method — which
only works when the vault is already unlocked. No encryption is bypassed.
No data is sent anywhere. Everything runs locally in your browser.

---

## Development

```bash
npm install
npm test          # run all tests
npm run build:firefox   # produces dist/passwarden-firefox-v1.0.0.xpi
npm run build:chrome    # produces dist/passwarden-chrome-v1.0.0.zip
```

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with install instructions for Firefox and Chrome"
```

---

## Task 9: Build Scripts + Push

**Files:**
- Create: `build/package-firefox.js`
- Create: `build/package-chrome.js`

- [ ] **Step 1: Create `build/package-firefox.js`**

```javascript
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const version = require('../package.json').version;
const outDir = path.join(__dirname, '../dist');
const outFile = path.join(outDir, `passwarden-firefox-v${version}.xpi`);

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const output = fs.createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => console.log(`Created ${outFile} (${archive.pointer()} bytes)`));
archive.on('error', err => { throw err; });

archive.pipe(output);

// Include all extension files, exclude tests/build/node_modules
['manifest.json', 'popup', 'background', 'scripts', 'utils', 'icons'].forEach(item => {
  const full = path.join(__dirname, '..', item);
  if (fs.statSync(full).isDirectory()) {
    archive.directory(full, item);
  } else {
    archive.file(full, { name: item });
  }
});

archive.finalize();
```

- [ ] **Step 2: Create `build/package-chrome.js`**

```javascript
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const version = require('../package.json').version;
const outDir = path.join(__dirname, '../dist');
const outFile = path.join(outDir, `passwarden-chrome-v${version}.zip`);

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const output = fs.createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => console.log(`Created ${outFile} (${archive.pointer()} bytes)`));
archive.on('error', err => { throw err; });

archive.pipe(output);

['manifest.json', 'popup', 'background', 'scripts', 'utils', 'icons'].forEach(item => {
  const full = path.join(__dirname, '..', item);
  if (fs.statSync(full).isDirectory()) {
    archive.directory(full, item);
  } else {
    archive.file(full, { name: item });
  }
});

archive.finalize();
```

- [ ] **Step 3: Test both build scripts**

```bash
npm run build:firefox
npm run build:chrome
```

Expected:
```
Created .../dist/passwarden-firefox-v1.0.0.xpi (XXXX bytes)
Created .../dist/passwarden-chrome-v1.0.0.zip (XXXX bytes)
```

- [ ] **Step 4: Add `dist/` to .gitignore (already done in Task 1 — verify)**

```bash
grep dist .gitignore
```

Expected: `dist/` appears in output.

- [ ] **Step 5: Run full test suite one final time**

```bash
npm test
```

Expected: all tests pass, zero failures.

- [ ] **Step 6: Commit build scripts**

```bash
git add build/
git commit -m "feat: build scripts for Firefox .xpi and Chrome .zip packaging"
```

- [ ] **Step 7: Push to GitHub**

```bash
eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519
git push origin main
```

Expected: branch pushes cleanly to `github.com:kevin-ripley/passwarden`.

---

## Post-Implementation: Manual Smoke Test

After all tasks are complete, load the extension in Firefox and verify end-to-end:

1. Open Firefox, ensure Bitwarden is installed and vault is **locked**
2. Load PassWarden via `about:debugging` → Load Temporary Add-on → `manifest.json`
3. Click PassWarden icon → click Export → verify "vault is locked" message appears + "Unlock Bitwarden" button
4. Click "Unlock Bitwarden" → unlock Bitwarden vault → return to PassWarden
5. Click Export → verify two files download: `passwarden_export.csv` + `passwarden_export.json`
6. Open CSV in a text editor — verify header row and credentials are correct
7. Open JSON in a text editor — verify `encrypted: false` and `items` array with correct structure
