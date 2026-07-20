// _shared/twOcr.ts — TWSE BSR CAPTCHA OCR via Lovable AI Gateway (vision)
// 回傳 5 碼英數字（大寫），失敗回 null。
// 內含影像預處理管線：灰階 → 對比拉伸 → Otsu 二值化 → 中值去噪 → 2x 放大。
// 每次呼叫會依序嘗試「重度預處理 / 輕度預處理 / 原圖」三個變體，
// 取兩個以上一致結果或第一個合法 5 碼作為輸出，用以壓低 captcha_retry_exhausted。
import UPNG from "npm:upng-js@2.1.0";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const MODEL = "google/gemini-2.5-flash-lite";

type RGBA = { w: number; h: number; data: Uint8ClampedArray };

export async function ocrTwseCaptcha(pngBytes: Uint8Array): Promise<string | null> {
  if (!LOVABLE_API_KEY) return null;

  const variants: Uint8Array[] = [];
  try {
    const img = decodePng(pngBytes);
    variants.push(encodePng(preprocess(img, { threshold: true, upscale: 2 })));
    variants.push(encodePng(preprocess(img, { threshold: false, upscale: 2 })));
  } catch {
    // Fall through to raw only if decode fails
  }
  variants.push(pngBytes);

  const results: string[] = [];
  for (const bytes of variants) {
    const guess = await callVision(bytes);
    if (guess) {
      // First majority wins: if any two variants agree, return immediately.
      if (results.includes(guess)) return guess;
      results.push(guess);
    }
  }
  return results[0] || null;
}

async function callVision(pngBytes: Uint8Array): Promise<string | null> {
  const dataUrl = `data:image/png;base64,${base64Encode(pngBytes)}`;
  const body = {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "The image is a TWSE CAPTCHA showing exactly 5 characters (uppercase A-Z and digits 0-9). " +
              "Return ONLY those 5 characters, no punctuation, no spaces, no explanation.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 12,
  };
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    const raw = String(j?.choices?.[0]?.message?.content || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    return raw.length === 5 ? raw : null;
  } catch {
    return null;
  }
}

// ---------- PNG codec ----------
function decodePng(bytes: Uint8Array): RGBA {
  const img = UPNG.decode(bytes);
  const rgba = new Uint8ClampedArray(UPNG.toRGBA8(img)[0]);
  return { w: img.width, h: img.height, data: rgba };
}

function encodePng(img: RGBA): Uint8Array {
  const buf = UPNG.encode([img.data.buffer], img.w, img.h, 0);
  return new Uint8Array(buf);
}

// ---------- Preprocessing pipeline ----------
function preprocess(
  src: RGBA,
  opts: { threshold: boolean; upscale: number },
): RGBA {
  let img = toGrayscale(src);
  img = contrastStretch(img);
  if (opts.threshold) {
    img = otsuBinarize(img);
    img = medianDenoise(img);
  }
  if (opts.upscale > 1) img = nearestUpscale(img, opts.upscale);
  return img;
}

function toGrayscale(src: RGBA): RGBA {
  const out = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2];
    const y = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    out[i] = out[i + 1] = out[i + 2] = y;
    out[i + 3] = 255;
  }
  return { w: src.w, h: src.h, data: out };
}

function contrastStretch(src: RGBA): RGBA {
  let min = 255, max = 0;
  for (let i = 0; i < src.data.length; i += 4) {
    const v = src.data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(1, max - min);
  const out = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = ((src.data[i] - min) * 255 / range) | 0;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { w: src.w, h: src.h, data: out };
}

function otsuBinarize(src: RGBA): RGBA {
  const hist = new Array(256).fill(0);
  const total = (src.data.length / 4) | 0;
  for (let i = 0; i < src.data.length; i += 4) hist[src.data[i]]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; thr = t; }
  }
  const out = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = src.data[i] > thr ? 255 : 0;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { w: src.w, h: src.h, data: out };
}

function medianDenoise(src: RGBA): RGBA {
  const { w, h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  const buf: number[] = new Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          buf[n++] = data[(yy * w + xx) * 4];
        }
      }
      buf.length = n;
      buf.sort((a, b) => a - b);
      const m = buf[(n / 2) | 0];
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = m;
      out[i + 3] = 255;
      buf.length = 9;
    }
  }
  return { w, h, data: out };
}

function nearestUpscale(src: RGBA, factor: number): RGBA {
  const nw = src.w * factor, nh = src.h * factor;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = (y / factor) | 0;
    for (let x = 0; x < nw; x++) {
      const sx = (x / factor) | 0;
      const si = (sy * src.w + sx) * 4;
      const di = (y * nw + x) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { w: nw, h: nh, data: out };
}

// ---------- base64 ----------
function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(bin);
}
