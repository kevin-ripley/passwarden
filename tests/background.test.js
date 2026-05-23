// jest-webextension-mock sets up chrome.* APIs globally
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

  test('returns not_found when no Bitwarden tab exists', async () => {
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 Firefox/124.0',
      configurable: true
    });
    chrome.tabs.query.mockResolvedValue([]);
    const { handleExport } = loadBackground();
    const result = await handleExport();
    expect(result.status).toBe('not_found');
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
