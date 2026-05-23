# PassWarden

Export your Bitwarden logins (username, password, URL) from Firefox as a CSV and
Bitwarden-importable JSON file — with one click. Personally I forgot my master and there
was no way to export login information without the master. Therefore I created a 
program that could run for me since I had over 1,000 entries. I hope it helps someone else
if they ever forget their master password, but their vault is still unlocked, and 
they need to copy and paste all their login information into a new bitwarden account.

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
