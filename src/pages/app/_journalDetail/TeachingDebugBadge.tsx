import { richHtmlToPlain } from '@/components/SafeRichHtml';

/**
 * 偵錯用徽章：只在預覽／管理員／?debug=1 情境顯示，
 * 用來判斷 learning_points 是 null、空字串，還是只剩空標籤。
 */
export const TeachingDebugBadge = ({ raw }: { raw: string | null }) => {
  const rawStr = raw ?? '';
  const rawLen = rawStr.length;
  const plain = rawStr ? richHtmlToPlain(rawStr) : '';
  const plainLen = plain.length;
  const imgCount = (rawStr.match(/<img\b/gi) || []).length;
  const iframeCount = (rawStr.match(/<iframe\b/gi) || []).length;
  const status = raw === null ? 'null' : raw === '' ? 'empty-string' : plainLen === 0 && imgCount === 0 ? 'html-no-text-no-img' : 'ok';
  const tone =
    status === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'null' || status === 'empty-string' ? 'bg-rose-50 text-rose-700 border-rose-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
  return (
    <div
      data-testid="jd-learning-debug"
      data-lp-status={status}
      data-lp-raw-len={rawLen}
      data-lp-plain-len={plainLen}
      data-lp-img-count={imgCount}
      className={`mt-1 mb-2 inline-flex flex-wrap items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-mono ${tone}`}
    >
      <span className="font-semibold">learning_points</span>
      <span>status={status}</span>
      <span>raw={rawLen}b</span>
      <span>plain={plainLen}b</span>
      <span>img={imgCount}</span>
      {iframeCount > 0 && <span>iframe={iframeCount}</span>}
    </div>
  );
};
