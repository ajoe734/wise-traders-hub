import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { exportJournalPdf } from '@/lib/exportJournalPdf';
import { avatarUrl } from '@/lib/imageTransform';
import { taipeiIsoToDisplayDate, taipeiWeekFridayIso } from '@/lib/taipeiWeek';
import type { SignalDetail } from './types';

interface ExportArgs {
  signal: SignalDetail | null;
  weekSignals: SignalDetail[];
  weekStartIso: string;
  weekTitle: string;
  learningPoints: string[];
  canExportPdf: boolean;
}

/**
 * PDF 匯出接縫：前端按鈕 + 後端 authorize-pdf-export 授權閘門，
 * 錯誤一律回傳可重試的訊息（頁面只負責呈現）。
 */
export const useJournalPdfExport = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportPdf = async (args: ExportArgs): Promise<void> => {
    const { signal, weekSignals, weekStartIso, weekTitle, learningPoints, canExportPdf } = args;
    if (!canExportPdf) {
      toast.error('僅後台管理員可匯出 PDF');
      return;
    }
    if (isExporting || !signal) return;
    setIsExporting(true);
    setExportError(null);
    const toastId = toast.loading('驗證權限並產生 PDF 中…');
    try {
      // Backend authorization gate — refuses non-admin callers even if the
      // frontend check was bypassed.
      const { data: authz, error: authzErr } = await supabase.functions.invoke(
        'authorize-pdf-export',
        { body: {} },
      );
      if (authzErr || !authz?.allowed) {
        const msg = authz?.message || authzErr?.message || '後端拒絕匯出授權';
        throw new Error(msg);
      }

      await exportJournalPdf({
        headSignal: signal as any,
        weekSignals: weekSignals as any,
        weekStart: taipeiIsoToDisplayDate(weekStartIso),
        weekEnd: taipeiIsoToDisplayDate(taipeiWeekFridayIso(weekStartIso)),
        weekTitle,
        learningPoints,
        avatarSrc: avatarUrl(signal.experts.avatar_url, 240),
      });
      toast.success('已匯出週記 PDF', { id: toastId });
    } catch (e: any) {
      console.error('[exportJournalPdf]', e);
      const reason = e?.message ? String(e.message) : '未知錯誤';
      setExportError(reason);
      toast.error(`匯出 PDF 失敗：${reason}`, {
        id: toastId,
        duration: 8000,
        action: { label: '重試匯出', onClick: () => void exportPdf(args) },
      });
    } finally {
      setIsExporting(false);
    }
  };

  return { isExporting, exportError, exportPdf };
};
