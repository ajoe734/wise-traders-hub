import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, PLAN_TYPE_LABEL, type PlanRow, type DefaultRule } from '@/pages/_companyPlans/types';

interface Props {
  loading: boolean;
  tab: 'pending' | 'all';
  filtered: PlanRow[];
  defaultRule: DefaultRule;
  onOpen: (id: string) => void;
}

export default function PlansTable({ loading, tab, filtered, defaultRule, onOpen }: Props) {
  const renderSplitCell = (p: PlanRow) => {
    if (p.override && p.override.is_active) {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] bg-primary/10 text-primary font-medium">
          {p.override.pct_platform}/{p.override.pct_expert}（覆寫）
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[11px] bg-muted text-muted-foreground">
        {defaultRule.pct_platform}/{defaultRule.pct_expert}（預設）
      </span>
    );
  };

  return (
    <Card>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />載入中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            {tab === 'pending' ? '目前沒有待審核的方案' : '尚無方案'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>分析師</TableHead>
                <TableHead>方案</TableHead>
                <TableHead>類型</TableHead>
                <TableHead className="text-right">月費</TableHead>
                <TableHead className="text-center">上架</TableHead>
                <TableHead className="text-center">審核</TableHead>
                <TableHead className="text-center">分潤</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => {
                const status = STATUS_LABEL[p.review_status];
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => onOpen(p.id)}
                  >
                    <TableCell>
                      <div className="font-medium">{p.experts?.name || '—'}</div>
                      <div className="text-xs text-muted-foreground">/{p.experts?.slug}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1 max-w-[260px]">
                          {p.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {PLAN_TYPE_LABEL[p.plan_type] || p.plan_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      NT$ {p.price_monthly.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={p.is_active ? 'default' : 'outline'} className="text-[11px]">
                        {p.is_active ? '上架中' : '已下架'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={cn('text-[11px] border', status.cls)} variant="outline">
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {renderSplitCell(p)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
                      >
                        管理
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
