// Erzeugt ein MJPEG mit einem EAN-13-Strichcode als künstliches Kamerabild.
const { chromium } = require("playwright");
const fs = require("fs");
const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = L.map((s) => [...s].map((c) => (c === "0" ? "1" : "0")).join(""));
const P = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
const base = "978315000001";
let sum = 0; for (let i = 0; i < 12; i++) sum += +base[i] * (i % 2 ? 3 : 1);
const code = base + ((10 - (sum % 10)) % 10);
let bits = "101";
for (let i = 1; i <= 6; i++) bits += (P[+code[0]][i - 1] === "L" ? L : G)[+code[i]];
bits += "01010";
for (let i = 7; i <= 12; i++) bits += R[+code[i]];
bits += "101";
const m = 6;
const rects = [...bits].map((b, i) => (b === "1" ? `<rect x="${(i + 12) * m}" y="40" width="${m}" height="260"/>` : "")).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" style="background:#fff">
<rect width="1280" height="720" fill="#f4efe4"/><g transform="translate(330,180)"><rect width="${(bits.length + 24) * m}" height="360" fill="#fff"/>${rects}
<text x="${((bits.length + 24) * m) / 2}" y="340" font-size="34" text-anchor="middle" font-family="monospace">${code}</text></g>
<text x="40" y="80" font-size="40" font-family="serif">Testbuch – Rückseite</text></svg>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.setContent(`<body style="margin:0">${svg}</body>`);
  const jpg = await p.screenshot({ type: "jpeg", quality: 92 });
  await b.close();
  fs.writeFileSync("cam.mjpeg", Buffer.concat(Array(10).fill(jpg)));
  console.log("ISBN", code);
})();
