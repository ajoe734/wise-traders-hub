// _shared/twOcr.ts — TWSE BSR CAPTCHA OCR via Lovable AI Gateway (vision)
// 回傳 5 碼英數字（大寫），失敗回 null。
//
// 影像前處理策略（每個變體都是獨立的處理鏈）：
//   1. raw            — 原圖直送（保底）
//   2. otsu           — 灰階 → 對比拉伸 → Otsu 二值化 → 中值去噪 → 內容裁切 → 2x 放大
//   3. adaptive       — 灰階 → CLAHE-like 局部對比 → adaptive threshold → open/close → 裁切 → 2x
//   4. dilate         — otsu 基礎 + 形態學膨脹（補回細筆劃）
//   5. loose_crop     — 只裁切 + 3x 放大（不做二值化，保留 anti-alias 資訊給 Vision）
//
// OCR 模式（依 config.ocr_mode 或呼叫端傳入）：
//   - "fast"       → 只跑 [raw]
//   - "standard"   → [otsu, adaptive, raw]（default）
//   - "aggressive" → [otsu, adaptive, dilate, loose_crop, raw]，任兩者相同即回傳
//
// 每個變體結果都會累積投票，優先回傳「兩票以上共識」，否則回傳第一個合法 5 碼。
import UPNG from "npm:upng-js@2.1.0";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const MODEL = "google/gemini-2.5-flash-lite";

type RGBA = { w: number; h: number; data: Uint8ClampedArray };

export type OcrMode = "fast" | "standard" | "aggressive";
export type OcrVariantName = "raw" | "otsu" | "adaptive" | "dilate" | "loose_crop";

export interface OcrResult {
  text: string | null;
  mode: OcrMode;
  attempts: Array<{ variant: OcrVariantName; guess: string | null }>;
  winner?: { variant: OcrVariantName; votes: number };
}

const VARIANT_PLAN: Record<OcrMode, OcrVariantName[]> = {
  fast: ["raw"],
  standard: ["otsu", "adaptive", "raw"],
  aggressive: ["otsu", "adaptive", "dilate", "loose_crop", "raw"],
};

export async function ocrTwseCaptcha(
  pngBytes: Uint8Array,
  mode: OcrMode = "standard",
): Promise<string | null> {
  const result = await ocrTwseCaptchaDetailed(pngBytes, mode);
  return result.text;
}

export async function ocrTwseCaptchaDetailed(
  pngBytes: Uint8Array,
  mode: OcrMode = "standard",
): Promise<OcrResult> {
  const attempts: OcrResult["attempts"] = [];
  if (!LOVABLE_API_KEY) return { text: null, mode, attempts };

  let src: RGBA | null = null;
  try { src = decodePng(pngBytes); } catch { src = null; }

  const plan = VARIANT_PLAN[mode] ?? VARIANT_PLAN.standard;
  const votes = new Map<string, { count: number; variant: OcrVariantName }>();
  let first: { variant: OcrVariantName; guess: string } | null = null;

  for (const variant of plan) {
    const bytes = buildVariant(variant, src, pngBytes);
    if (!bytes) { attempts.push({ variant, guess: null }); continue; }
    const guess = await callVision(bytes);
    attempts.push({ variant, guess });
    if (!guess) continue;
    if (!first) first = { variant, guess };
    const entry = votes.get(guess);
    if (entry) {
      entry.count += 1;
      // 兩票即共識，立即回傳
      return { text: guess, mode, attempts, winner: { variant: entry.variant, votes: entry.count } };
    }
    votes.set(guess, { count: 1, variant });
  }

  if (first) {
    return {
      text: first.guess,
      mode,
      attempts,
      winner: { variant: first.variant, votes: 1 },
    };
  }
  return { text: null, mode, attempts };
}

function buildVariant(
  variant: OcrVariantName,
  src: RGBA | null,
  raw: Uint8Array,
): Uint8Array | null {
  if (variant === "raw") return raw;
  if (!src) return null;
  try {
    switch (variant) {
      case "otsu": {
        let img = toGrayscale(src);
        img = contrastStretch(img);
        img = otsuBinarize(img);
        img = medianDenoise(img);
        img = cropToContent(img, { padding: 2, darkIsInk: true });
        img = nearestUpscale(img, 2);
        return encodePng(img);
      }
      case "adaptive": {
        let img = toGrayscale(src);
        img = localContrast(img, 15);
        img = adaptiveThreshold(img, 15, 8);
        img = morphOpen(img);   // 去除孤立雜點
        img = morphClose(img);  // 補回斷筆
        img = cropToContent(img, { padding: 2, darkIsInk: true });
        img = nearestUpscale(img, 2);
        return encodePng(img);
      }
      case "dilate": {
        let img = toGrayscale(src);
        img = contrastStretch(img);
        img = otsuBinarize(img);
        img = medianDenoise(img);
        img = morphDilate(img, /*darkIsInk*/ true);
        img = cropToContent(img, { padding: 3, darkIsInk: true });
        img = nearestUpscale(img, 2);
        return encodePng(img);
      }
      case "loose_crop": {
        let img = toGrayscale(src);
        img = contrastStretch(img);
        // 用 Otsu 找 mask，但只用來抓 bounding box，回貼原灰階
        const mask = otsuBinarize(img);
        const box = contentBox(mask, /*darkIsInk*/ true, /*padding*/ 4);
        if (box) img = cropRect(img, box);
        img = nearestUpscale(img, 3);
        return encodePng(img);
      }
    }
  } catch {
    return null;
  }
  return null;
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

// ---------- Preprocessing primitives ----------
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

// 以區塊 min/max 拉伸局部對比（簡化版 CLAHE）。win 為區塊半徑。
function localContrast(src: RGBA, win: number): RGBA {
  const { w, h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - win), y1 = Math.min(h - 1, y + win);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - win), x1 = Math.min(w - 1, x + win);
      let mn = 255, mx = 0;
      for (let yy = y0; yy <= y1; yy += 2) {
        for (let xx = x0; xx <= x1; xx += 2) {
          const v = data[(yy * w + xx) * 4];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      const range = Math.max(1, mx - mn);
      const v = ((data[(y * w + x) * 4] - mn) * 255 / range) | 0;
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = Math.max(0, Math.min(255, v));
      out[i + 3] = 255;
    }
  }
  return { w, h, data: out };
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

// 適應性門檻：像素 vs 區塊平均值 - offset。win 為區塊半徑。
function adaptiveThreshold(src: RGBA, win: number, offset: number): RGBA {
  const { w, h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  // 建立積分圖以 O(1) 取區塊和
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += data[((y - 1) * w + (x - 1)) * 4];
      sat[y * (w + 1) + x] = sat[(y - 1) * (w + 1) + x] + rowSum;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - win), y1 = Math.min(h - 1, y + win);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - win), x1 = Math.min(w - 1, x + win);
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const s =
        sat[(y1 + 1) * (w + 1) + (x1 + 1)] -
        sat[y0 * (w + 1) + (x1 + 1)] -
        sat[(y1 + 1) * (w + 1) + x0] +
        sat[y0 * (w + 1) + x0];
      const mean = s / area;
      const i = (y * w + x) * 4;
      const v = data[i] > mean - offset ? 255 : 0;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return { w, h, data: out };
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

// 形態學：僅在二值圖上操作（0/255）
function morphErode(src: RGBA, darkIsInk = true): RGBA {
  const { w, h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  const ink = darkIsInk ? 0 : 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let allInk = true;
      for (let dy = -1; dy <= 1 && allInk; dy++) {
        for (let dx = -1; dx <= 1 && allInk; dx++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          if (data[(yy * w + xx) * 4] !== ink) allInk = false;
        }
      }
      const v = allInk ? ink : (darkIsInk ? 255 : 0);
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return { w, h, data: out };
}

function morphDilate(src: RGBA, darkIsInk = true): RGBA {
  const { w, h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  const ink = darkIsInk ? 0 : 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let anyInk = false;
      for (let dy = -1; dy <= 1 && !anyInk; dy++) {
        for (let dx = -1; dx <= 1 && !anyInk; dx++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          if (data[(yy * w + xx) * 4] === ink) anyInk = true;
        }
      }
      const v = anyInk ? ink : (darkIsInk ? 255 : 0);
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return { w, h, data: out };
}

function morphOpen(src: RGBA): RGBA { return morphDilate(morphErode(src, true), true); }
function morphClose(src: RGBA): RGBA { return morphErode(morphDilate(src, true), true); }

// ---------- 內容裁切（動態擴框）----------
function contentBox(
  src: RGBA,
  darkIsInk: boolean,
  padding: number,
): { x: number; y: number; w: number; h: number } | null {
  const { w, h, data } = src;
  const ink = darkIsInk ? 0 : 255;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[(y * w + x) * 4];
      const isInk = darkIsInk ? v <= 64 : v >= 191;
      if (!isInk) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const x1 = Math.min(w - 1, maxX + padding);
  const y1 = Math.min(h - 1, maxY + padding);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // 保護：若裁到 <60% 面積視為異常，放棄裁切
  if (bw * bh < w * h * 0.15) return null;
  return { x: x0, y: y0, w: bw, h: bh };
}

function cropRect(src: RGBA, box: { x: number; y: number; w: number; h: number }): RGBA {
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const sy = box.y + y;
    for (let x = 0; x < box.w; x++) {
      const si = (sy * src.w + (box.x + x)) * 4;
      const di = (y * box.w + x) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { w: box.w, h: box.h, data: out };
}

function cropToContent(src: RGBA, opts: { padding: number; darkIsInk: boolean }): RGBA {
  const box = contentBox(src, opts.darkIsInk, opts.padding);
  if (!box) return src;
  return cropRect(src, box);
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
