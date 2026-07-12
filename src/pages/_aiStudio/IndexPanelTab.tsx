import AiIndexCard from '@/pages/_adminProfile/AiIndexCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Props { expertId: string; expertName: string; canEdit: boolean; }

export default function IndexPanelTab({ expertId, expertName, canEdit }: Props) {
  const { data } = useQuery({
    queryKey: ['ai-studio-stats', expertId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('expert-ai-studio', {
        body: { action: 'stats', expert_id: expertId },
      });
      if (error) throw error;
      return data.stats as { manual: number; auto: number; pending: number };
    },
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">週記自動條目</p><p className="text-2xl font-semibold mt-1">{data?.auto ?? '-'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">手動條目</p><p className="text-2xl font-semibold mt-1">{data?.manual ?? '-'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">待審核</p><p className="text-2xl font-semibold mt-1 text-amber-600">{data?.pending ?? '-'}</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">週記自動索引</CardTitle>
          <CardDescription>
            將你已發佈的週記（expert_signals）與個人簡介／策略欄位重新 embed 到 AI 知識庫。<strong>不會影響手動條目</strong>。建議每次新增／編輯週記後點一次；新週記發佈當天自動排程尚未上線，目前需手動觸發。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AiIndexCard expertId={expertId} expertName={expertName} isReadOnly={!canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}
