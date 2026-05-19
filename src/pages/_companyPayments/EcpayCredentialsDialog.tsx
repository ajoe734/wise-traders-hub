import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EcpayCredsRow } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ecpay: EcpayCredsRow;
  setEcpay: React.Dispatch<React.SetStateAction<EcpayCredsRow>>;
  ecpayHasKey: boolean;
  ecpayHasIV: boolean;
  ecpayHashKeyInput: string;
  setEcpayHashKeyInput: (v: string) => void;
  ecpayHashIVInput: string;
  setEcpayHashIVInput: (v: string) => void;
  ecpayOriginal: EcpayCredsRow;
  onSave: () => void;
}

export function EcpayCredentialsDialog({
  open, onOpenChange, ecpay, setEcpay,
  ecpayHasKey, ecpayHasIV,
  ecpayHashKeyInput, setEcpayHashKeyInput,
  ecpayHashIVInput, setEcpayHashIVInput,
  ecpayOriginal, onSave,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => {
      onOpenChange(o);
      if (o) {
        setEcpay(ecpayOriginal);
        setEcpayHashKeyInput('');
        setEcpayHashIVInput('');
      }
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>綠界 ECPay 金鑰</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          綠界後台只會給你三組值：<b>MerchantID</b>、<b>HashKey</b>、<b>HashIV</b>。
          收單網址（Action URL）由系統依「環境」自動套用，<b>不需要手動填</b>。
          金鑰只儲存於後台資料庫，前端不會讀取；HashKey 與 HashIV 留空表示「不變更」既有值。
        </p>
        <div className="grid grid-cols-1 gap-3 mt-2">
          <div>
            <Label className="text-xs">商店代號 MerchantID</Label>
            <Input
              value={ecpay.merchant_id || ''}
              placeholder="例：3268740"
              onChange={(e) => setEcpay((p) => ({ ...p, merchant_id: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">
              HashKey {ecpayHasKey && <span className="text-muted-foreground">（目前已設定 ••••••••，留空＝不變更）</span>}
            </Label>
            <Input
              type="password"
              value={ecpayHashKeyInput}
              placeholder={ecpayHasKey ? '••••••••（留空表示不變更）' : '請輸入 HashKey'}
              onChange={(e) => setEcpayHashKeyInput(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label className="text-xs">
              HashIV {ecpayHasIV && <span className="text-muted-foreground">（目前已設定 ••••••••，留空＝不變更）</span>}
            </Label>
            <Input
              type="password"
              value={ecpayHashIVInput}
              placeholder={ecpayHasIV ? '••••••••（留空表示不變更）' : '請輸入 HashIV'}
              onChange={(e) => setEcpayHashIVInput(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label className="text-xs">環境</Label>
            <Select
              value={ecpay.env || 'stage'}
              onValueChange={(v) => setEcpay((p) => ({ ...p, env: v as 'stage' | 'production' }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stage">測試環境（Stage）</SelectItem>
                <SelectItem value="production">正式環境（Production）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              系統將自動使用：
              <code className="ml-1 text-[10px]">
                {(ecpay.env === 'production')
                  ? 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
                  : 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'}
              </code>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setEcpay(ecpayOriginal); setEcpayHashKeyInput(''); setEcpayHashIVInput(''); onOpenChange(false); }}>取消</Button>
          <Button onClick={onSave}>儲存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
