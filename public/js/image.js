// Fotos im Browser verkleinern und prüfen.
export const FULL_EDGE = 2000;
export const THUMB_EDGE = 400;
export const JPEG_QUALITY = 0.85;

// Schwellen der Sofortprüfung. Bewusst vorsichtig: Es ist nur ein Hinweis,
// das Foto kann trotzdem behalten werden.
const BLUR_THRESHOLD = 30; // Varianz des Laplace-Filters auf 320 px Breite
const DARK_THRESHOLD = 45; // mittlere Helligkeit 0–255

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function scaled(source, sw, sh, maxEdge) {
  const f = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.round(sw * f), h = Math.round(sh * f);
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

function toBlob(c, quality = JPEG_QUALITY) {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht erzeugt werden"))), "image/jpeg", quality),
  );
}

/** Schärfe (Laplace-Varianz) und Helligkeit auf einer kleinen Graustufen-Kopie. */
export function measure(source, sw, sh) {
  const c = scaled(source, sw, sh, 320);
  const { width: w, height: h } = c;
  const data = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    g[j] = v;
    sum += v;
  }
  let n = 0, mean = 0, m2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
      n++;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  const sharpness = n > 1 ? m2 / (n - 1) : 0;
  const brightness = sum / (w * h);
  return {
    sharpness: Math.round(sharpness),
    brightness: Math.round(brightness),
    blurry: sharpness < BLUR_THRESHOLD,
    dark: brightness < DARK_THRESHOLD,
  };
}

/** Aus Videobild oder Bilddatei: großes Foto, Vorschaubild, Prüfwerte. */
export async function processSource(source, sw, sh) {
  const big = scaled(source, sw, sh, FULL_EDGE);
  const small = scaled(big, big.width, big.height, THUMB_EDGE);
  const [full, thumb] = await Promise.all([toBlob(big), toBlob(small, 0.8)]);
  return { full, thumb, width: big.width, height: big.height, quality: measure(big, big.width, big.height) };
}

export async function fromVideo(video) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) throw new Error("Kamera liefert noch kein Bild");
  return processSource(video, w, h);
}

/** Datei aus der Kamera-App. <img> berücksichtigt die EXIF-Drehung. */
export async function fromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return await processSource(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}
