import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil } from 'lucide-react';
import type { PendingDraft } from './pendingDrafts';

interface Props {
  drafts: PendingDraft[];
  publishMomentLabel: string;
  isReadOnly: boolean;
  onEdit: (batchId: string) => void;
}

const formatSavedAt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * 待發布週記草稿區：公開時間之前，老師可以無限次回來修改。
 */
export function PendingDraftsCard({ drafts, publishMomentLabel, isReadOnly, onEdit }: Props) {
  if (drafts.length === 0) return null;

  return (
    <Card className="border-mentor/40" data-testid="pending-drafts-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">尚未公開的週記</h2>
            <Badge className="bg-mentor text-mentor-foreground hover:bg-mentor text-xs">
              {drafts.length} 篇
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {publishMomentLabel}前都可以繼續修改，改幾次都可以；按「更新週記」才會存檔。
          </p>
        </div>

        <div className="space-y-2">
          {drafts.map((d) => (
            <div
              key={d.batchId}
              data-testid="pending-draft-item"
              className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-3 flex-wrap"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{d.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {d.isTeachingOnly ? '純教學週記' : `${d.tradeCount} 檔操作`}
                  {d.instruments.length > 0 && ` · ${d.instruments.slice(0, 3).join('、')}${d.instruments.length > 3 ? '⋯' : ''}`}
                  {` · 最後儲存 ${formatSavedAt(d.lastSavedAt)}`}
                </p>
              </div>
              <Button
                size="sm"
                className="bg-mentor hover:bg-mentor/90 gap-1"
                disabled={isReadOnly}
                onClick={() => onEdit(d.batchId)}
              >
                <Pencil className="h-3.5 w-3.5" /> 繼續編輯
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
