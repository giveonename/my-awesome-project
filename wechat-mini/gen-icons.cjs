// Generate simple 81x81 tabbar PNG icons using pure Node.js (no dependencies)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, rgba) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c2 = n;
      for (let k = 0; k < 8; k++) {
        c2 = (c2 & 1) ? (0xedb88320 ^ (c2 >>> 1)) : (c2 >>> 1);
      }
      table[n] = c2;
    }
    for (let i = 0; i < buf.length; i++) {
      c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type);
    const crcData = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - image data
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter none
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      rawData.push(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]);
    }
  }
  const compressed = zlib.deflateSync(Buffer.from(rawData));

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function drawCircle(rgba, width, height, cx, cy, r, color) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const idx = (y * width + x) * 4;
        rgba[idx] = color[0];
        rgba[idx + 1] = color[1];
        rgba[idx + 2] = color[2];
        rgba[idx + 3] = color[3];
      }
    }
  }
}

function drawRect(rgba, width, height, x1, y1, x2, y2, color) {
  for (let y = Math.max(0, y1); y <= Math.min(height - 1, y2); y++) {
    for (let x = Math.max(0, x1); x <= Math.min(width - 1, x2); x++) {
      const idx = (y * width + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }
}

function drawTriangle(rgba, width, height, cx, cy, size, color) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dy = y - (cy - size * 0.4);
      const halfW = (dy / (size * 0.8)) * size * 0.5;
      if (dy >= 0 && dy <= size * 0.8 && Math.abs(x - cx) <= halfW) {
        const idx = (y * width + x) * 4;
        rgba[idx] = color[0];
        rgba[idx + 1] = color[1];
        rgba[idx + 2] = color[2];
        rgba[idx + 3] = color[3];
      }
    }
  }
}

function drawLine(rgba, width, height, x1, y1, x2, y2, thick, color) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let t = ((x - x1) * dx + (y - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const dist = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      if (dist <= thick / 2) {
        const idx = (y * width + x) * 4;
        rgba[idx] = color[0];
        rgba[idx + 1] = color[1];
        rgba[idx + 2] = color[2];
        rgba[idx + 3] = color[3];
      }
    }
  }
}

const W = 81, H = 81;
const gray = [153, 153, 153, 255];
const dark = [51, 51, 51, 255];

function makeIcon(type, active) {
  const rgba = new Uint8Array(W * H * 4);
  const c = active ? dark : gray;

  switch (type) {
    case 'home': // house shape
      drawTriangle(rgba, W, H, 40, 28, 30, c);
      drawRect(rgba, W, H, 25, 38, 55, 62, c);
      drawRect(rgba, W, H, 35, 45, 45, 62, [255, 255, 255, 255]); // door
      break;
    case 'wardrobe': // rectangle = closet
      drawRect(rgba, W, H, 18, 14, 62, 67, c);
      drawLine(rgba, W, H, 40, 14, 40, 67, 3, c); // divider
      drawCircle(rgba, W, H, 36, 40, 3, c); // knob left
      drawCircle(rgba, W, H, 44, 40, 3, c); // knob right
      break;
    case 'suggest': // star / sparkle
      drawCircle(rgba, W, H, 40, 40, 10, c);
      for (let a = 0; a < 5; a++) {
        const angle = (a * 72 - 90) * Math.PI / 180;
        const ex = 40 + Math.cos(angle) * 25;
        const ey = 40 + Math.sin(angle) * 25;
        drawLine(rgba, W, H, 40, 40, Math.round(ex), Math.round(ey), 3, c);
      }
      break;
    case 'history': // clock
      drawCircle(rgba, W, H, 40, 40, 25, c);
      drawCircle(rgba, W, H, 40, 40, 20, [255, 255, 255, 255]);
      drawLine(rgba, W, H, 40, 40, 40, 22, 3, c); // hour
      drawLine(rgba, W, H, 40, 40, 52, 40, 3, c); // minute
      break;
    case 'profile': // person
      drawCircle(rgba, W, H, 40, 28, 14, c);
      drawCircle(rgba, W, H, 40, 65, 22, c); // body
      drawRect(rgba, W, H, 0, 0, 0, 0, [255, 255, 255, 0]); // clip fix
      // Clear top portion of body circle
      for (let y = 0; y < 42; y++) {
        for (let x = 0; x < W; x++) {
          const dx = x - 40;
          const dy = y - 65;
          if (dx * dx + dy * dy <= 22 * 22) {
            const idx = (y * W + x) * 4;
            rgba[idx] = 0; rgba[idx+1] = 0; rgba[idx+2] = 0; rgba[idx+3] = 0;
          }
        }
      }
      break;
  }

  return createPNG(W, H, rgba);
}

const assetsDir = path.join(__dirname, 'src', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

const icons = ['home', 'wardrobe', 'suggest', 'history', 'profile'];

icons.forEach(name => {
  const normalPath = path.join(assetsDir, `tab-${name}.png`);
  const activePath = path.join(assetsDir, `tab-${name}-active.png`);

  fs.writeFileSync(normalPath, makeIcon(name, false));
  fs.writeFileSync(activePath, makeIcon(name, true));

  console.log(`Created: tab-${name}.png, tab-${name}-active.png`);
});

console.log('All tabbar icons generated!');