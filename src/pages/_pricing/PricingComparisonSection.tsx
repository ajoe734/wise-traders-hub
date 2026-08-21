import { Radio, BookOpen, Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Row {
  label: string;
  follower: string;
  cultivator: string;
  /** 該面向誰比較適合／有優勢；用於視覺 highlight */
  emphasis?: 'follower' | 'cultivator' | 'both' | 'neither';
}

const ROWS: Row[] = [
  {
    label: '訊號時效',
    follower: '即時 LINE 通知，分析師下單同步推播',
    cultivator: '每週固定週次公開，內容為當週操作復盤',
    emphasis: 'follower',
  },
  {
    label: '適合的使用時段',
    follower: '盤中能看盤或收得到手機通知',
    cultivator: '平日忙碌、只有週末能研究',
    emphasis: 'both',
  },
  {
    label: '你會拿到的內容',
    follower: '進出場價位、部位比重、即時策略拆解',
    cultivator: '當週操作復盤、判斷依據、下週研究清單與觀察條件',
    emphasis: 'both',
  },
  {
    label: '學習曲線',
    follower: '低 — 照訊號執行即可',
    cultivator: '中 — 透過復盤逐步養成自己的判斷',
    emphasis: 'cultivator',
  },
  {
    label: '使用節奏',
    follower: '跟隨分析師的當日／短線節奏',
    cultivator: '週末消化整週紀錄與觀察框架，較少盤中干擾',
    emphasis: 'cultivator',
  },
  {
    label: '適合的目標',
    follower: '想省時間、直接跟著操作',
    cultivator: '想練方法、建立自己的交易系統',
    emphasis: 'both',
  },
];

export function PricingComparisonSection() {
  return (
    <section
      className="max-w-5xl mx-auto mb-16"
      data-testid="pricing-comparison-section"
      aria-labelledby="pricing-comparison-title"
    >
      <div className="text-center mb-6">
        <h2
          id="pricing-comparison-title"
          className="text-xl md:text-2xl font-bold mb-2"
        >
          方案差異一次看懂
        </h2>
        <p className="text-sm text-muted-foreground">
          投顧分析師的「即時訂閱」 vs 實戰導師的「每週復盤／修煉派」
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-xl border border-border overflow-hidden bg-card">
        <table
          className="w-full text-sm"
          data-testid="pricing-comparison-table"
          aria-describedby="pricing-comparison-title"
        >
          <caption className="sr-only">
            跟單派（分析師即時訂閱）與修煉派（實戰導師每週復盤）方案差異比較
          </caption>
          <thead>
            <tr className="bg-muted/40">
              <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground w-[22%]">
                比較面向
              </th>
              <th scope="col" className="text-left px-4 py-3 font-semibold">
                <div className="flex items-center gap-2 text-advisor">
                  <Radio className="h-4 w-4" />
                  跟單派 · 分析師即時訂閱
                </div>
              </th>
              <th scope="col" className="text-left px-4 py-3 font-semibold">

                <div className="flex items-center gap-2 text-mentor">
                  <BookOpen className="h-4 w-4" />
                  修煉派 · 實戰導師每週復盤
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, idx) => (
              <tr
                key={row.label}
                className={cn(
                  'border-t border-border align-top',
                  idx % 2 === 1 && 'bg-muted/20'
                )}
              >
                <td className="px-4 py-3 font-medium text-foreground">{row.label}</td>
                <td
                  className={cn(
                    'px-4 py-3',
                    row.emphasis === 'follower' && 'text-foreground font-medium'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <ColMark on={row.emphasis === 'follower' || row.emphasis === 'both'} tone="advisor" />
                    <span>{row.follower}</span>
                  </div>
                </td>
                <td
                  className={cn(
                    'px-4 py-3',
                    row.emphasis === 'cultivator' && 'text-foreground font-medium'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <ColMark on={row.emphasis === 'cultivator' || row.emphasis === 'both'} tone="mentor" />
                    <span>{row.cultivator}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked */}
      <ul
        className="md:hidden space-y-4 list-none p-0"
        aria-label="方案差異比較（手機版逐列呈現）"
        data-testid="pricing-comparison-stack"
      >
        {ROWS.map((row) => (
          <li
            key={row.label}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="text-xs font-medium text-muted-foreground mb-3">
              {row.label}
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Radio className="h-4 w-4 text-advisor flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-xs text-advisor font-semibold mb-0.5">跟單派</div>
                  <div className="text-sm text-foreground leading-relaxed">{row.follower}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 pt-3 border-t border-border/60">
                <BookOpen className="h-4 w-4 text-mentor flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-xs text-mentor font-semibold mb-0.5">修煉派</div>
                  <div className="text-sm text-foreground leading-relaxed">{row.cultivator}</div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}


function ColMark({ on, tone }: { on: boolean; tone: 'advisor' | 'mentor' }) {
  if (!on) {
    return <Minus className="h-4 w-4 text-muted-foreground/50 flex-shrink-0 mt-0.5" />;
  }
  return (
    <Check
      className={cn(
        'h-4 w-4 flex-shrink-0 mt-0.5',
        tone === 'advisor' ? 'text-advisor' : 'text-mentor'
      )}
    />
  );
}
