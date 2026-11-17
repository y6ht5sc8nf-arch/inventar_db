// Live-Kamera (Rückkamera) und ISBN-Scan.

export async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Live-Kamera wird von diesem Browser nicht unterstützt");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  video.setAttribute("playsinline", "");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
  return () => {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

/** Prüfziffer einer ISBN-13 (= EAN-13 mit 978/979). */
export function isIsbn13(code) {
  if (!/^97[89]\d{10}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

export function formatIsbn(code) {
  return code && code.length === 13 ? `${code.slice(0, 3)}-${code.slice(3, 12)}-${code[12]}` : code;
}

let zxingPromise;
function loadZxing() {
  return (zxingPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/zxing-0.23.0.min.js";
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error("Barcode-Bibliothek nicht ladbar"));
    document.head.append(s);
  }));
}

async function makeDetector() {
  if ("BarcodeDetector" in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.includes("ean_13")) {
        const d = new BarcodeDetector({ formats: ["ean_13"] });
        return async (canvas) => (await d.detect(canvas)).map((b) => b.rawValue);
      }
    } catch { /* Rückfall unten */ }
  }
  const Z = await loadZxing();
  const reader = new Z.MultiFormatReader();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  return async (canvas) => {
    try {
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return [reader.decodeWithState(bmp).getText()];
    } catch {
      return [];
    }
  };
}

/** Sucht laufend im Kamerabild nach einer ISBN. Gibt eine Stopp-Funktion zurück. */
export function scanIsbn(video, onFound) {
  let stopped = false;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d", { willReadFrequently: true });
  (async () => {
    let detect;
    try { detect = await makeDetector(); } catch { return; }
    while (!stopped) {
      const w = video.videoWidth, h = video.videoHeight;
      if (w && h) {
        const f = Math.min(1, 1000 / Math.max(w, h));
        c.width = Math.round(w * f);
        c.height = Math.round(h * f);
        ctx.drawImage(video, 0, 0, c.width, c.height);
        for (const code of await detect(c)) {
          if (isIsbn13(code)) { onFound(code); break; }
        }
      }
      await new Promise((r) => setTimeout(r, 350));
    }
  })();
  return () => { stopped = true; };
}
