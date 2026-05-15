import { Eye, X } from 'lucide-react';
import { usePreviewMode } from '@/hooks/usePreviewMode';

export function PreviewBanner() {
  const { isPreview, previewExpertName, previewSlug, exitPreview } = usePreviewMode();
  if (!isPreview) return null;

  const handleExit = () => {
    exitPreview();
    // 嘗試關閉分頁（後台另開時可關），失敗則導回後台
    const closed = window.opener;
    if (closed) {
      window.close();
    } else if (previewSlug) {
      window.location.href = `/admin/${previewSlug}`;
    } else {
      window.location.reload();
    }
  };

  return (
    <div className="sticky top-0 z-[60] bg-amber-500/95 text-amber-950 text-xs">
      <div className="flex items-center justify-between gap-3 px-4 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            預覽模式：以「{previewExpertName}」訂閱者身分檢視
          </span>
        </div>
        <button
          onClick={handleExit}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/10 hover:bg-amber-950/20 transition-colors shrink-0"
        >
          <X className="h-3 w-3" />
          退出預覽
        </button>
      </div>
    </div>
  );
}
