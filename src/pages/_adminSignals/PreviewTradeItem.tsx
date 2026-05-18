import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Lightbulb, Target, AlertTriangle } from 'lucide-react';
import { actionLabels } from './actionLabels';

interface Props {
  action: string;
  instrument: string;
  priceHint?: number | null;
  reasonSummary: string;
  reasonDetail: string;
  riskNotes: string;
}

export const PreviewTradeItem = ({
  action,
  instrument,
  priceHint,
  reasonSummary,
  reasonDetail,
  riskNotes,
}: Props) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = reasonSummary || reasonDetail || riskNotes;
  const ai = actionLabels[action] || actionLabels.buy;
  return (
    <div className="px-4 py-3">
      <div
        className={`flex items-center gap-3 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <Badge className={cn(ai.className, 'text-[10px] px-1.5 py-0')}>{ai.label}</Badge>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{instrument}</span>
          {priceHint != null && (
            <span className="text-xs text-muted-foreground ml-1">@{priceHint}</span>
          )}
        </div>
        {hasDetails && (
          <button className="text-muted-foreground shrink-0">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <div className="mt-3 ml-9 space-y-3">
          {reasonSummary && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <Lightbulb className="h-3.5 w-3.5 text-primary" /> 為什麼這樣操作？
              </h3>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{reasonSummary}</p>
            </div>
          )}
          {reasonDetail && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <Target className="h-3.5 w-3.5 text-primary" /> 部位控管想法
              </h3>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{reasonDetail}</p>
            </div>
          )}
          {riskNotes && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> 風險提醒
              </h3>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{riskNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
