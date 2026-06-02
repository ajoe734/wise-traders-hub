import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import type { AdminPlan } from '@/hooks/admin/useAdminPlansData';
import { PLAN_TYPE_LABEL, REVIEW_STATUS_LABEL } from './constants';

interface Props {
  plans: AdminPlan[];
  counts: Record<string, number>;
  isReadOnly: boolean;
  onEdit: (p: AdminPlan) => void;
  onToggleActive: (p: AdminPlan) => void;
}

export function PlansTable({ plans, counts, isReadOnly, onEdit, onToggleActive }: Props) {
  return (
    <Card>
      <CardContent className="p-0">
        {plans.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            尚未建立任何方案，請點擊右上「新增方案」
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名稱</TableHead>
                <TableHead>類型</TableHead>
                <TableHead className="text-right">月費</TableHead>
                <TableHead className="text-right">年費</TableHead>
                <TableHead className="text-center">訂閱人數</TableHead>
                <TableHead className="text-center">審核狀態</TableHead>
                <TableHead className="text-center">啟用</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => {
                const rs = REVIEW_STATUS_LABEL[p.review_status] || REVIEW_STATUS_LABEL.draft;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">{p.description}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {PLAN_TYPE_LABEL[p.plan_type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      NT$ {p.price_monthly.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.price_yearly != null ? `NT$ ${p.price_yearly.toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{counts[p.id] || 0}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={cn('text-[11px] border', rs.cls)} variant="outline">
                        {rs.label}
                      </Badge>
                      {p.review_status === 'rejected' && p.review_note && (
                        <div className="text-[10px] text-destructive mt-1 max-w-[160px] mx-auto line-clamp-2">
                          退回原因：{p.review_note}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <PermissionTooltip disabled={isReadOnly}>
                        <Switch
                          checked={p.is_active}
                          onCheckedChange={() => !isReadOnly && onToggleActive(p)}
                          disabled={isReadOnly}
                        />
                      </PermissionTooltip>
                    </TableCell>
                    <TableCell className="text-right">
                      <PermissionTooltip disabled={isReadOnly}>
                        <Button variant="ghost" size="sm" onClick={() => onEdit(p)} disabled={isReadOnly}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </PermissionTooltip>
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
