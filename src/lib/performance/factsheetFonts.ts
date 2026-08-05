import type jsPDF from 'jspdf';

/**
 * PDF 中文字型嵌入（向量文字，非截圖）。
 * 字型檔為 Noto Sans TC（SIL Open Font License 1.1，允許嵌入與再散布），
 * 由 @fontsource/noto-sans-tc 的 chinese-traditional subset 轉為 TTF 放在 /fonts/。
 * 只有在使用者實際按下匯出時才 lazy fetch，不進 main bundle。
 */

export const PDF_FONT = 'NotoSansTC';
export const FONT_LICENSE = 'Noto Sans TC — SIL Open Font License 1.1';

const FILES = [
  { file: 'NotoSansTC-Regular.ttf', style: 'normal' },
  { file: 'NotoSansTC-Bold.ttf', style: 'bold' },
] as const;

const cache = new Map<string, string>();

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function embedPdfFonts(doc: jsPDF): Promise<void> {
  for (const { file, style } of FILES) {
    let b64 = cache.get(file);
    if (!b64) {
      const res = await fetch(`/fonts/${file}`);
      if (!res.ok) throw new Error(`字型載入失敗（${file}）：HTTP ${res.status}`);
      b64 = toBase64(await res.arrayBuffer());
      cache.set(file, b64);
    }
    doc.addFileToVFS(file, b64);
    doc.addFont(file, PDF_FONT, style);
  }
  doc.setFont(PDF_FONT, 'normal');
}
