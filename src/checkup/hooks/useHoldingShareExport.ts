// 把任意 DOM ref 轉成 PNG，提供「下載」「複製到剪貼簿」兩種 action。
// 用於持倉抽屜的 Share Mode：使用者點分享 → render Share container → 截圖輸出。
import { useCallback, useState } from 'react';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';

export interface UseHoldingShareExportOptions {
  /** 截圖背景色（避免某些瀏覽器算成透明） */
  backgroundColor?: string;
  /** 解析度倍率，預設 2x（retina） */
  pixelRatio?: number;
}

export function useHoldingShareExport(opts: UseHoldingShareExportOptions = {}) {
  const { backgroundColor = '#FFFFFF', pixelRatio = 2 } = opts;
  const [busy, setBusy] = useState(false);

  const render = useCallback(async (node: HTMLElement): Promise<string | null> => {
    try {
      // 等一個 frame 讓 fade-out 的操作 UI 真的不在畫面上
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const dataUrl = await toPng(node, {
        backgroundColor,
        pixelRatio,
        cacheBust: true,
        // html-to-image 對外部圖片有 CORS 風險，這個面板目前沒有外圖
        skipFonts: false,
      });
      return dataUrl;
    } catch (e: any) {
      toast.error(`截圖失敗：${e?.message || e}`);
      return null;
    }
  }, [backgroundColor, pixelRatio]);

  const download = useCallback(async (node: HTMLElement | null, filename: string) => {
    if (!node) return;
    setBusy(true);
    try {
      const dataUrl = await render(node);
      if (!dataUrl) return;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('已下載');
    } finally {
      setBusy(false);
    }
  }, [render]);

  const copy = useCallback(async (node: HTMLElement | null) => {
    if (!node) return;
    setBusy(true);
    try {
      const dataUrl = await render(node);
      if (!dataUrl) return;
      // dataURL → Blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      if (!('clipboard' in navigator) || !('write' in navigator.clipboard) || typeof ClipboardItem === 'undefined') {
        toast.message('此瀏覽器不支援複製圖片，改為下載');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `holding-${Date.now()}.png`;
        document.body.appendChild(a); a.click(); a.remove();
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

  return { busy, download, copy };
}
