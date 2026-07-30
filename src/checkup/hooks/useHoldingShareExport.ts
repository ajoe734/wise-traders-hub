// 持倉抽屜的截圖匯出 hook：PNG（多倍率）/ PDF（jspdf）/ 剪貼簿。
//
// 設計重點：
//   - 目標 DOM 由呼叫端提供（screenRef 或離屏 exportRef），本 hook 不負責 mount。
//   - PNG 直接走 html-to-image，pixelRatio 可調（預設 3，retina×3 ≈ 印刷品質）。
//   - PDF 用 jspdf 把同一張 PNG 鋪滿單頁；square=210×210mm 自訂頁面，
//     wide=A4 橫向 297×210mm 並依 16:9 置中（實際內容 297×167mm）。
//   - 剪貼簿沿用既有 toPng → Blob → navigator.clipboard.write，無支援 fallback 下載。

import { useCallback, useState } from 'react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { toast } from 'sonner';
import { getCheckupGateway } from '../lib/gateway';

export type ExportRatio = 'square' | 'wide';

export interface UseHoldingShareExportOptions {
  backgroundColor?: string;
  /** 預設 pixelRatio，可在呼叫時覆寫 */
  pixelRatio?: number;
}

interface ExportOptions {
  pixelRatio?: number;
  /** 設定後會等該 ms 再截圖，留時間讓 layout/字型/圖片 ready */
  beforeRenderDelayMs?: number;
}

export function useHoldingShareExport(opts: UseHoldingShareExportOptions = {}) {
  const { backgroundColor = '#FFFFFF', pixelRatio: defaultPR = 3 } = opts;
  const [busy, setBusy] = useState(false);

  const render = useCallback(async (node: HTMLElement, o: ExportOptions = {}): Promise<string | null> => {
    try {
      // 給離屏 DOM 一點時間佈局完成
      await new Promise<void>((r) => setTimeout(r, o.beforeRenderDelayMs ?? 80));
      const dataUrl = await toPng(node, {
        backgroundColor,
        pixelRatio: o.pixelRatio ?? defaultPR,
        cacheBust: true,
        skipFonts: false,
      });
      return dataUrl;
    } catch (e: any) {
      toast.error(`截圖失敗：${e?.message || e}`);
      return null;
    }
  }, [backgroundColor, defaultPR]);

  const downloadPng = useCallback(async (node: HTMLElement | null, filename: string, o?: ExportOptions) => {
    if (!node) return;
    setBusy(true);
    try {
      const dataUrl = await render(node, o);
      if (!dataUrl) return;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      toast.success('已下載 PNG');
    } finally {
      setBusy(false);
    }
  }, [render]);

  const downloadPdf = useCallback(async (node: HTMLElement | null, filename: string, ratio: ExportRatio, o?: ExportOptions) => {
    if (!node) return;
    setBusy(true);
    try {
      // 解析度由呼叫端決定（std=2 / high=3 / print=4），PDF 不再強制覆寫
      const dataUrl = await render(node, o);
      if (!dataUrl) return;

      let pdf: jsPDF;
      if (ratio === 'square') {
        // 自訂正方形 210×210mm（接近 IG post 比例，方便列印剪裁）
        pdf = new jsPDF({ unit: 'mm', format: [210, 210], orientation: 'portrait' });
        pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 210, undefined, 'FAST');
      } else {
        // A4 橫向 297×210mm；16:9 內容尺寸 = 297×167.06mm，垂直置中（上下留白 21.47mm）
        pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
        const w = 297;
        const h = w * 9 / 16; // 167.06
        const top = (210 - h) / 2;
        pdf.addImage(dataUrl, 'PNG', 0, top, w, h, undefined, 'FAST');
      }
      const name = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
      pdf.save(name);
      toast.success('已下載 PDF');
    } catch (e: any) {
      toast.error(`PDF 匯出失敗：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [render]);

  const copy = useCallback(async (node: HTMLElement | null, o?: ExportOptions) => {
    if (!node) return;
    setBusy(true);
    try {
      const dataUrl = await render(node, o);
      if (!dataUrl) return;
      const blob = await getCheckupGateway().http.blob(dataUrl);
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `holding-${Date.now()}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        toast.message('此瀏覽器不支援複製圖片，已改為下載');
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast.success('已複製到剪貼簿');
    } catch (e: any) {
      toast.error(`複製失敗：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [render]);

  return { busy, downloadPng, downloadPdf, copy, render };
}
