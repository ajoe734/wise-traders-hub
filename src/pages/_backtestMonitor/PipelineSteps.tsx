import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, Clock, XCircle } from 'lucide-react';
import type { StepInfo, StepState } from './types';

const stepIcon = (s: StepState) => {
  if (s === 'done') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (s === 'running') return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
  if (s === 'pending') return <Clock className="h-4 w-4 text-amber-600" />;
  if (s === 'failed') return <XCircle className="h-4 w-4 text-red-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
};
const stepBorder = (s: StepState) => {
  if (s === 'done') return 'border-emerald-300 bg-emerald-50/40';
  if (s === 'running') return 'border-blue-300 bg-blue-50/40';
  if (s === 'pending') return 'border-amber-300 bg-amber-50/40';
  if (s === 'failed') return 'border-red-300 bg-red-50/40';
  return 'border-border';
};

export function PipelineSteps({ steps }: { steps: StepInfo[] }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-medium mb-3">管線狀態（Backfill → Backtest → Notify）</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {steps.map((s) => (
            <div key={s.key} className={`rounded-md border p-3 ${stepBorder(s.state)}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                {stepIcon(s.state)}
                <span>{s.label}</span>
                <Badge variant="outline" className="ml-auto text-[10px] uppercase">{s.state}</Badge>
              </div>
              <div className="text-xs text-foreground/80 mt-2">{s.detail}</div>
              {s.hint && (
                <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">💡 {s.hint}</div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
