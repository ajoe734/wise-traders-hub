import React from 'react';
import { SafeRichHtml } from '@/components/SafeRichHtml';
import { FxHint } from '@/components/FxHint';
import type { SignalRowViewModel } from './useSignalRowViewModel';

interface Props {
  vm: SignalRowViewModel;
  as: 'tr' | 'div';
  colSpan?: number;
}

/**
 * 展開區塊：同時服務 table `<td colSpan>` 與 card 底部。
 * 只寫一份，以 `as` prop 切換外層 wrapper。
 */
export function SignalExpandedDetails({ vm, as, colSpan }: Props) {
  const e = vm.expanded;
  const body = (
    <div className="bg-muted/30 px-6 py-3 text-xs space-y-2">
      {e.teachingTopic && <Section label="教學主題"><p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{e.teachingTopic}</p></Section>}
      {e.overallSummary && <Section label="整體摘要"><p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{e.overallSummary}</p></Section>}
      {e.reasonSummary && <Section label="為什麼這樣操作？"><SafeRichHtml html={e.reasonSummary} className="mt-0.5 text-xs" /></Section>}
      {e.reasonDetail && <Section label="部位控管想法"><SafeRichHtml html={e.reasonDetail} className="mt-0.5 text-xs" /></Section>}
      {e.riskNotes && <Section label="風險提醒"><SafeRichHtml html={e.riskNotes} className="mt-0.5 text-xs" /></Section>}
      {e.learningPoints && <Section label="教學重點"><SafeRichHtml html={e.learningPoints} className="mt-0.5 text-xs" /></Section>}
      {vm.price?.fx && (
        <div>
          <span className="font-medium text-foreground">換算</span>
          <FxHint amount={vm.price.fx.amount} currency={vm.price.fx.currency} showMeta={false} forceAuto className="block mt-0.5" />
        </div>
      )}
    </div>
  );

  if (as === 'tr') {
    return (
      <tr className="border-b last:border-0">
        <td colSpan={colSpan} className="p-0">{body}</td>
      </tr>
    );
  }
  return <div className="border-t border-border/40">{body}</div>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}
