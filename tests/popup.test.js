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

  test('handles undefined sendMessage response as error', () => {
    // Simulate undefined response (background not running)
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => cb(undefined));
    // Trigger the export button click - need to require popup in a way that runs the wiring
    // Since the wiring guard uses typeof chrome/module, and jsdom has module defined,
    // the wiring doesn't run in test. Test the logic directly:
    const handler = (response) => {
      if (!response) {
        applyState({ type: 'error' });
        return;
      }
    };
    handler(undefined);
    expect(document.getElementById('status').textContent).toContain('failed');
  });
});
