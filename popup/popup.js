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
if (typeof module === 'undefined') {
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
