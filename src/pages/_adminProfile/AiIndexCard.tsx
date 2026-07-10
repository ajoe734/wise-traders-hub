import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import AiIndexStatusPanel from './AiIndexStatusPanel';

interface Props {
  expertId: string;
  expertName: string;
  isReadOnly: boolean;
}

export default function AiIndexCard({ expertId, expertName, isReadOnly }: Props) {
  const [building, setBuilding] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; indexed?: number; error?: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRebuild = async () => {
    if (building) return;
    setBuilding(true);
    setLastResult(null);
    // 立即刷新一次，讓面板顯示 running 狀態
    setRefreshKey((k) => k + 1);
    const poll = setInterval(() => setRefreshKey((k) => k + 1), 4000);
    try {
      const { data, error } = await supabase.functions.invoke('expert-ai-index', {
        body: { expert_id: expertId, trigger_source: 'manual' },
      });
      if (error) throw error;
      if (data?.ok) {
        setLastResult({ ok: true, indexed: data.indexed });
        toast.success(`已完成 ${expertName} 的 AI 知識索引，共 ${data.indexed} 段`);
      } else {
        throw new Error(data?.message || '索引建立失敗');
      }
    } catch (e: any) {
      const msg = e?.message || '索引建立失敗';
      setLastResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      clearInterval(poll);
      setRefreshKey((k) => k + 1);
      setBuilding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-mentor" />
          AI 分身知識索引
        </CardTitle>
        <CardDescription>
          將你的個人簡介、策略描述、所有已發佈週記 embedding 進 AI 知識庫，供訂閱者在導師頁「問老師 AI」功能中檢索。
          <br />
          <span className="text-xs">建議在新增／編輯週記後重建一次；一次約需 1-3 分鐘。</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={handleRebuild}
          disabled={building || isReadOnly}
          variant="outline"
          className="border-mentor/50 text-mentor hover:bg-mentor/5 hover:text-mentor"
        >
          {building ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />建立索引中…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" />重建 AI 索引</>
          )}
        </Button>
        {lastResult?.ok && (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            已索引 {lastResult.indexed} 段內容
          </div>
        )}
        {lastResult && !lastResult.ok && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {lastResult.error}
          </div>
        )}
      </CardContent>
      <CardContent className="pt-0">
        <AiIndexStatusPanel expertId={expertId} refreshKey={refreshKey} />
      </CardContent>
    </Card>
  );
}
