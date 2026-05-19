import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Landmark, Pencil } from 'lucide-react';
import { REMIT_FIELDS } from './types';

interface Props {
  remit: Record<string, string>;
  setRemit: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  remitOriginal: Record<string, string>;
  remitConfigured: boolean;
  remitOpen: boolean;
  setRemitOpen: (o: boolean) => void;
  onSave: () => void;
}

export function RemittanceCard({
  remit, setRemit, remitOriginal, remitConfigured, remitOpen, setRemitOpen, onSave,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Landmark className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">匯款</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">買方手動匯款使用的全站帳戶資訊</p>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              {remitConfigured ? (
                <div className="text-sm space-y-0.5">
                  <div className="text-foreground font-medium">
                    {remit.bank_name} <span className="text-muted-foreground font-normal">({remit.bank_code})</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ••••{(remit.account_number || '').slice(-4)} · {remit.account_name}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">尚未設定匯款帳戶資訊</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {remitConfigured ? '已啟用' : '未設定'}
              </Badge>
              <Dialog open={remitOpen} onOpenChange={setRemitOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 text-xs">
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />{remitConfigured ? '編輯' : '設定'}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>匯款帳戶資訊</DialogTitle></DialogHeader>
                  <p className="text-xs text-muted-foreground">
                    此資訊會顯示於結帳頁，供買方手動匯款使用。匯款訂單的審核請至「匯款審核」。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                    {REMIT_FIELDS.map((f) => (
                      <div key={f.key}>
                        <Label className="text-xs">{f.label}</Label>
                        <Input
                          value={remit[f.key] || ''}
                          placeholder={f.placeholder}
                          onChange={(e) => setRemit((p) => ({ ...p, [f.key]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setRemit(remitOriginal); setRemitOpen(false); }}>取消</Button>
                    <Button onClick={onSave}>儲存</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
