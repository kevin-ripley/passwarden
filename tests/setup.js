// Extend jest-webextension-mock with chrome.scripting which it doesn't include
if (typeof chrome !== 'undefined' && !chrome.scripting) {
  chrome.scripting = {
    executeScript: jest.fn()
  };
}
