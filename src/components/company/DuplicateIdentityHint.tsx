import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertCircle } from 'lucide-react';
import { REASON_LABEL, type DuplicateCluster } from '@/lib/duplicateIdentity';
import { formatTaipeiYMD } from '@/checkup/utils/formatTaipeiDate';

interface Props {
  cluster: DuplicateCluster;
  /** 目前這一列的會員，用來把「另一個帳號」標示出來 */
  userId: string;
}

/**
 * 「這個人可能有兩個帳號」的列內提示。顏色不單獨承載意義，一律附文字。
 */
export function DuplicateIdentityHint({ cluster, userId }: Props) {
  const others = cluster.members.filter((m) => m.user_id !== userId);
  if (others.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="duplicate-identity-hint"
          className="inline-flex items-center gap-1 rounded border border-yellow-500/40 px-1.5 py-0 text-[10px] text-yellow-700 hover:bg-yellow-500/10"
          title="疑似同一人有多個登入身分"
        >
          <AlertCircle className="h-3 w-3" />
          可能有 {cluster.members.length} 個帳號
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs space-y-2">
        <div className="font-medium text-sm">疑似同一人的其他帳號</div>
        <div className="text-muted-foreground">
          判定依據：{cluster.reasons.map((r) => REASON_LABEL[r]).join('、')}
        </div>
        <ul className="space-y-2" data-testid="duplicate-identity-others">
          {others.map((m) => (
            <li key={m.user_id} className="border-t pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-2">
                <span className="rounded border px-1 py-0 text-[10px]">
                  {m.is_line ? 'Line 登入' : 'Email 登入'}
                </span>
                <span className="font-medium">{m.display_name || m.user_id.slice(0, 8)}</span>
              </div>
              <div className="text-muted-foreground mt-0.5 break-all">
                {m.is_line ? `Line ${(m.line_user_id || '').slice(-6)}` : m.email}
              </div>
              <div className="text-muted-foreground mt-0.5">
                最後登入：{formatTaipeiYMD(m.last_sign_in_at) || '無紀錄'} ·{' '}
                {m.has_subscription ? '有有效訂閱' : '沒有訂閱'}
              </div>
            </li>
          ))}
        </ul>
        <div className="text-muted-foreground border-t pt-2">
          會員只能用其中一個帳號看到內容。可請他固定用有訂閱的那個登入，或按右側「代客綁定」合併 ——
          合併會把資料集中到主帳號，另一個帳號登入後會是空的。
        </div>
      </PopoverContent>
    </Popover>
  );
}
