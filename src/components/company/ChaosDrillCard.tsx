import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

type Check = { name: string; expected: string; actual: string; ok: boolean };
type ScenarioResult = { scenario: string; passed: boolean; checks: Check[]; actions: string[] };
type DrillResponse = {
  ok: boolean;
  passed: boolean;
  summary: string;
  cleaned_up: boolean;
  finished_at: string;
  results: ScenarioResult[];
};

const SCENARIO_LABEL: Record<string, string> = {
  kill_switch: '① Kill-switch 永久關閉',
  degrade: '② degrade 卡在 tier3_paused',
  quota_pool: '③ 配額池跨日未 reset / 預算被收緊',
};

/**
 * 壅塞演練：手動觸發 chips-chaos-drill，用固定假資料（drill_ 沙箱物件）
 * 重現三種壅塞情境，驗證 auto-heal 每次都恢復到 normal 且更新 reset_at / daily_budget。
 */
export function ChaosDrillCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DrillResponse | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('chips-chaos-drill', {
        body: { scenarios: ['kill_switch', 'degrade', 'quota_pool'], cleanup: true },
      });
      // 演練失敗時 function 回 422，invoke 會視為 error，仍嘗試讀取內容
      if (error && !data) throw error;
      const payload = (data ?? {}) as DrillResponse;
      setResult(payload);
      if (payload.passed) toast.success('壅塞演練全部通過');
      else toast.error(`演練未通過：${payload.summary ?? '未知'}`);
    } catch (e) {
      toast.error(`演練執行失敗：${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">壅塞演練（Chaos Drill）</CardTitle>
        <Button size="sm" onClick={run} disabled={running}>
          {running ? '演練中…' : '執行演練'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          用固定假資料（<code>drill_</code> 沙箱物件，不影響正式 pipeline）觸發三種壅塞情境，
          跑真正的 auto-heal，驗證每次都恢復 normal 並更新 reset_at / daily_budget。
        </p>

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={result.passed ? 'default' : 'destructive'}>
                {result.passed ? 'PASS' : 'FAIL'}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{result.summary}</span>
              {result.cleaned_up && <span className="text-xs text-muted-foreground">已清理沙箱資料</span>}
            </div>

            {result.results?.map((r) => (
              <div key={r.scenario} className="rounded border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={r.passed ? 'outline' : 'destructive'}>{r.passed ? 'PASS' : 'FAIL'}</Badge>
                  <span className="font-medium">{SCENARIO_LABEL[r.scenario] ?? r.scenario}</span>
                </div>
                <ul className="space-y-0.5">
                  {r.checks.map((c) => (
                    <li key={c.name} className={c.ok ? 'text-muted-foreground' : 'text-destructive'}>
                      {c.ok ? '✓' : '✗'} {c.name}
                      {!c.ok && <span className="font-mono text-xs">（預期 {c.expected} / 實際 {c.actual}）</span>}
                    </li>
                  ))}
                </ul>
                {r.actions?.length > 0 && (
                  <p className="font-mono text-[11px] text-muted-foreground break-all">
                    actions: {r.actions.join(' | ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
