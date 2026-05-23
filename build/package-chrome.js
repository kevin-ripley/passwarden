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
