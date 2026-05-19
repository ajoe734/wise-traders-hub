import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Plus, KeyRound, CheckCircle2, AlertTriangle, Circle, Star,
} from 'lucide-react';
import type { ChannelRow, ProviderType } from './types';

interface PaymentGroupSectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  rows: ChannelRow[];
  providerLabels: Record<ProviderType, string>;
  emptyText: string;
  onAdd: () => void;
  addLabel: string;
  onEcpayKeys: () => void;
  onUnsupportedKeys: (t: ProviderType) => void;
  onToggle: (id: string, isActive: boolean) => void;
  onSetDefault: (id: string) => void;
}

export const PaymentGroupSection = ({
  icon, title, description, rows, providerLabels: labels, emptyText,
  onAdd, addLabel, onEcpayKeys, onUnsupportedKeys, onToggle, onSetDefault,
}: PaymentGroupSectionProps) => {
  const StatusCell = ({ row }: { row: ChannelRow }) => {
    if (row.provider.is_active && row.credsStatus === 'complete') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-foreground">已啟用</span>
        </span>
      );
    }
    if (row.provider.is_active && row.credsStatus !== 'complete') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-amber-600">啟用但不可用</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Circle className="h-2.5 w-2.5" />
        停用
      </span>
    );
  };

  const CredsCell = ({ row }: { row: ChannelRow }) => {
    if (row.credsStatus === 'complete') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />完整
        </span>
      );
    }
    if (row.credsStatus === 'missing') {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-xs text-amber-600 cursor-help">
              <AlertTriangle className="h-3.5 w-3.5" />缺 {row.missingFields.length} 項
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <div className="font-medium mb-1">缺少欄位</div>
              <ul className="space-y-0.5">
                {row.missingFields.map((f) => <li key={f}>• {f}</li>)}
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }
    return <span className="text-xs text-muted-foreground">— 待開放</span>;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1.5" />{addLabel}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">{description}</p>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">通道</TableHead>
                  <TableHead className="w-[120px]">狀態</TableHead>
                  <TableHead className="w-[110px]">金鑰</TableHead>
                  <TableHead className="w-[80px]">環境</TableHead>
                  <TableHead className="w-[60px] text-center">預設</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const p = row.provider;
                  const isEcpay = p.provider_type === 'ecpay';
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium leading-tight">{p.display_name}</span>
                          <span className="text-[11px] text-muted-foreground leading-tight">
                            {labels[p.provider_type]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell><StatusCell row={row} /></TableCell>
                      <TableCell><CredsCell row={row} /></TableCell>
                      <TableCell>
                        {row.env ? (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {row.env === 'production' ? '正式' : '測試'}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {p.is_default ? (
                          <Star className="h-4 w-4 text-amber-500 fill-amber-500 inline" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSetDefault(p.id)}
                            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                            disabled={!p.is_active || row.credsStatus !== 'complete'}
                            title={!p.is_active || row.credsStatus !== 'complete' ? '需先啟用且金鑰完整' : ''}
                          >
                            設為預設
                          </button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            onClick={() => isEcpay ? onEcpayKeys() : onUnsupportedKeys(p.provider_type)}
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-1" />金鑰
                          </Button>
                          <Switch
                            checked={p.is_active}
                            onCheckedChange={() => onToggle(p.id, p.is_active)}
                            className="data-[state=checked]:bg-company"
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
