# PassWarden — Design Spec
**Date:** 2026-05-22
**Status:** Approved

## Overview

PassWarden is a browser extension for Firefox and Chrome that extracts login credentials from an already-unlocked Bitwarden vault and exports them as both a CSV and a Bitwarden-compatible JSON file — in a single click, with no separate tools or manual steps required.

**Primary use case:** Users who need to migrate their Bitwarden logins to a new account, or who want a portable backup, but cannot use the Bitwarden web vault export (e.g., Firefox-only users, accounts with restricted export permissions).

**Scope:** Logins only (type 1 ciphers — name, username, password, URL). Secure notes, credit cards, and identities are out of scope for v1.

---

## Architecture

PassWarden is a Manifest V3 browser extension with three logical layers:

```
┌─────────────────────────────────────────┐
│           Extension Popup UI            │  popup/popup.html + popup/popup.js
│   [Export Vault] button + status area   │
└────────────────┬────────────────────────┘
                 │ chrome.runtime.sendMessage
┌────────────────▼────────────────────────┐
│         Background Service Worker       │  background/background.js
│  - Detects Bitwarden extension ID       │
│  - Injects extraction script            │
│  - Receives decrypted cipher data       │
│  - Converts to CSV + Bitwarden JSON     │
│  - Triggers file downloads              │
└────────────────┬────────────────────────┘
                 │ chrome.scripting.executeScript
┌────────────────▼────────────────────────┐
│      Bitwarden Background Page          │  (Bitwarden's extension context)
│  - Reads active userId dynamically      │
│  - Calls getAllDecrypted(userId)         │
│  - Returns login ciphers to PassWarden  │
└─────────────────────────────────────────┘
```

### File Structure

```
passwarden/
├── manifest.json
├── popup/
│   ├── popup.html
│   └── popup.js
├── background/
│   └── background.js
├── scripts/
│   └── extractor.js         # injected into Bitwarden's background page
├── utils/
│   └── converter.js         # CSV + JSON conversion logic
├── tests/
│   ├── converter.test.js
│   ├── extractor.test.js
│   ├── background.test.js
│   └── integration/
│       └── pipeline.test.js
├── icons/
└── README.md
```

### Known Bitwarden Extension IDs

- **Firefox:** `{446900e4-71c2-419f-a6a7-df9c091e268b}`
- **Chrome:** `nngceckbapebfimnlniiiahkandclblb`

These are hardcoded in `background.js` and used to construct the Bitwarden background page URL for script injection.

---

## User Flow

### Happy Path (vault unlocked)

1. User clicks PassWarden toolbar icon → popup opens
2. User clicks **"Export Vault"** → button shows spinner + "Exporting..."
3. Background script injects `extractor.js` into Bitwarden's background page
4. Extractor auto-detects `userId` via `bitwardenMain.accountService.activeAccount$`, calls `getAllDecrypted(userId)`, filters to type 1 (login) only
5. Returns array of `{ name, username, password, uri }` to background script
6. Background script converts to CSV and Bitwarden JSON simultaneously
7. Two files download automatically: `passwarden_export.csv` + `passwarden_export.json`
8. Popup shows ✓ "Export complete — 2 files downloaded"

### Vault Locked

1. Extractor detects locked state (no active account or decrypted data returns empty/null)
2. Popup shows: **"Your Bitwarden vault is locked."**
3. **"Unlock Bitwarden"** button appears — clicking it opens the Bitwarden extension popup programmatically
4. User unlocks Bitwarden, returns to PassWarden popup, clicks Export again

### Error States

| Condition | Message shown |
|-----------|--------------|
| Bitwarden not installed | "Bitwarden extension not found. Please install it first." |
| Vault locked | "Your Bitwarden vault is locked." + Unlock button |
| Extraction failed | "Export failed. Make sure Bitwarden is unlocked and try again." |
| Chrome MV3 injection blocked | "Automatic export is not supported on this browser version. See README for the manual DevTools method." |

---

## Data Model

### Raw cipher (from Bitwarden, login type only)

```javascript
{
  name: "GitHub",
  type: 1,
  login: {
    username: "user@example.com",
    password: "abc123",
    uris: [{ uri: "https://github.com" }]
  }
}
```

### userId auto-detection (replaces hardcoded UUID)

```javascript
// Primary method
const account = await bitwardenMain.accountService.activeAccount$
  .pipe(first())
  .toPromise();
const userId = account?.id;

// Fallback
const userId = await bitwardenMain.stateService.getUserId();
```

### CSV output (`passwarden_export.csv`)

```
name,username,password,url
GitHub,user@example.com,abc123,https://github.com
```

### Bitwarden JSON output (`passwarden_export.json`)

```json
{
  "encrypted": false,
  "items": [
    {
      "type": 1,
      "name": "GitHub",
      "login": {
        "username": "user@example.com",
        "password": "abc123",
        "uris": [{ "match": null, "uri": "https://github.com" }]
      }
    }
  ]
}
```

### Conversion rules

- Filter: only include ciphers where `type === 1`
- URI: use first URI if multiple exist; use empty string if none
- Null-safe: handle missing `login`, `username`, `password`, and `uris` without throwing
- Single pass over the data generates both output formats

---

## Testing Strategy

All tests written before implementation (TDD). Test runner: **Jest**.

| File | Coverage |
|------|----------|
| `converter.test.js` | CSV + JSON happy path, empty vault, null username/password, missing URIs, 1000+ items performance, special characters (commas, quotes, unicode) |
| `extractor.test.js` | userId auto-detection, fallback method, locked vault detection, type filtering |
| `background.test.js` | Message passing popup↔background, download trigger, error propagation to UI |
| `integration/pipeline.test.js` | Full pipeline with stubbed `bitwardenMain` — locked and unlocked states, end-to-end extraction → conversion → download |

Run with: `npm test`

---

## Distribution

### GitHub Releases structure

```
passwarden-v1.0.0/
├── firefox/
│   └── passwarden-firefox-v1.0.0.xpi
├── chrome/
│   └── passwarden-chrome-v1.0.0.zip
└── README.md
```

### Install — Chrome

1. Download `passwarden-chrome-v1.0.0.zip` and unzip
2. Open Chrome → Settings → Extensions → Enable **Developer mode**
3. Click **Load unpacked** → select the unzipped `chrome/` folder

### Install — Firefox

1. Download `passwarden-firefox-v1.0.0.xpi`
2. Open Firefox → `about:debugging` → This Firefox → **Load Temporary Add-on**
3. Select the `.xpi` file

### Chrome MV3 caveat

If Chrome's service worker architecture blocks `chrome.scripting.executeScript` injection into Bitwarden's background context, the popup will display a message directing Chrome users to the manual DevTools fallback. Firefox is the primary fully-automatic target for v1.

---

## Out of Scope (v1)

- Secure notes, credit cards, identities
- Mozilla AMO or Chrome Web Store submission
- Encryption of exported files
- Folder/collection preservation
- TOTP/2FA fields
