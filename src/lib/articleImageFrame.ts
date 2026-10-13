/**
 * 教學文章截圖「確定性」相框：裁掉同色外框、放進統一比例的米白相框。
 * 不經 AI、不縮放原圖像素（1:1 貼上），所以截圖中的數字一個都不會變。
 */

export const FRAME_BG = '#F5F3EF';
export const FRAME_LINE = '#D9D4CB';
export const FRAME_RATIOS = [16 / 9, 4 / 3, 1, 3 / 4] as const;

export interface Box { x: number; y: number; w: number; h: number }

/** 找出與左上角同色（或透明）外框以內的內容框；全圖同色時回傳整張圖 */
export function computeTrimBox(data: Uint8ClampedArray | number[], w: number, h: number, tol = 12): Box {
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: Math.max(w, 0), h: Math.max(h, 0) };
  const r0 = data[0], g0 = data[1], b0 = data[2], a0 = data[3];
  const isBg = (i: number) => {
    const a = data[i + 3];
    if (a < 16 && a0 < 16) return true;
    return Math.abs(data[i] - r0) <= tol && Math.abs(data[i + 1] - g0) <= tol && Math.abs(data[i + 2] - b0) <= tol && Math.abs(a - a0) <= tol;
  };
  const rowBg = (y: number) => { for (let x = 0; x < w; x++) if (!isBg((y * w + x) * 4)) return false; return true; };
  const colBg = (x: number, y1: number, y2: number) => { for (let y = y1; y <= y2; y++) if (!isBg((y * w + x) * 4)) return false; return true; };
  let top = 0; while (top < h && rowBg(top)) top++;
  if (top === h) return { x: 0, y: 0, w, h };
  let bottom = h - 1; while (bottom > top && rowBg(bottom)) bottom--;
  let left = 0; while (left < w && colBg(left, top, bottom)) left++;
  let right = w - 1; while (right > left && colBg(right, top, bottom)) right--;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

export interface FrameLayout { width: number; height: number; dx: number; dy: number; ratio: number }

/** 依內容比例挑最接近的統一比例，加留白，內容置中且 1:1 不縮放 */
export function computeFrame(cw: number, ch: number): FrameLayout {
  const r = cw / Math.max(ch, 1);
  const ratio = FRAME_RATIOS.reduce((best, x) => (Math.abs(Math.log(x / r)) < Math.abs(Math.log(best / r)) ? x : best), FRAME_RATIOS[0] as number);
  const pad = Math.max(16, Math.round(Math.max(cw, ch) * 0.04));
  let width = cw + pad * 2;
  let height = ch + pad * 2;
  if (width / height < ratio) width = Math.ceil(height * ratio); else height = Math.ceil(width / ratio);
  return { width, height, dx: Math.floor((width - cw) / 2), dy: Math.floor((height - ch) / 2), ratio };
}

/** 瀏覽器端：讀圖 → 裁邊 → 相框，輸出 PNG */
export async function frameImage(src: string): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((ok, bad) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => ok(im); im.onerror = () => bad(new Error('圖片讀取失敗')); im.src = src;
  });
  const w = img.naturalWidth, h = img.naturalHeight;
  const probe = document.createElement('canvas'); probe.width = w; probe.height = h;
  const pctx = probe.getContext('2d')!; pctx.drawImage(img, 0, 0);
  const box = computeTrimBox(pctx.getImageData(0, 0, w, h).data, w, h);
  const f = computeFrame(box.w, box.h);
  const c = document.createElement('canvas'); c.width = f.width; c.height = f.height;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = FRAME_BG; ctx.fillRect(0, 0, f.width, f.height);
  ctx.drawImage(probe, box.x, box.y, box.w, box.h, f.dx, f.dy, box.w, box.h);
  ctx.strokeStyle = FRAME_LINE; ctx.lineWidth = 1;
  ctx.strokeRect(f.dx - 0.5, f.dy - 0.5, box.w + 1, box.h + 1);
  return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('輸出失敗'))), 'image/png'));
}
