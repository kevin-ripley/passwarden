const fs = require('fs');
const path = require('path');

// Minimal valid PNG file bytes for a colored square icon
// This creates a simple blue square PNG without any native dependencies
function createSimplePng(size) {
  // PNG signature
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeData = Buffer.concat([Buffer.from(type), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeData), 0);
    return Buffer.concat([len, typeData, crcBuf]);
  }

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);   // width
  ihdr.writeUInt32BE(size, 4);   // height
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // IDAT chunk - raw pixel data (blue #175DDC = r23,g93,b220)
  const zlib = require('zlib');
  const rowSize = size * 3 + 1; // filter byte + RGB pixels
  const raw = Buffer.alloc(size * rowSize);
  for (let y = 0; y < size; y++) {
    const offset = y * rowSize;
    raw[offset] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      raw[offset + 1 + x * 3] = 23;  // R
      raw[offset + 1 + x * 3 + 1] = 93;  // G
      raw[offset + 1 + x * 3 + 2] = 220; // B
    }
  }
  const compressed = zlib.deflateSync(raw);

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend)
  ]);
}

[16, 48, 128].forEach(size => {
  const buf = createSimplePng(size);
  const outPath = path.join(__dirname, `${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated icons/${size}.png (${buf.length} bytes)`);
});
