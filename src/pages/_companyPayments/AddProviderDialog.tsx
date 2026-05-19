import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProviderType } from './types';

interface Props {
  addGroup: 'credit' | 'ewallet' | null;
  onClose: () => void;
  newProviderType: ProviderType | '';
  setNewProviderType: (v: ProviderType | '') => void;
  newDisplayName: string;
  setNewDisplayName: (v: string) => void;
  onAdd: () => void;
}

export function AddProviderDialog({
  addGroup, onClose,
  newProviderType, setNewProviderType,
  newDisplayName, setNewDisplayName,
  onAdd,
}: Props) {
  return (
    <Dialog open={!!addGroup} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            新增{addGroup === 'credit' ? '信用卡' : '電子支付'}通道
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>金流類型</Label>
            <Select value={newProviderType} onValueChange={(v) => setNewProviderType(v as ProviderType)}>
              <SelectTrigger><SelectValue placeholder="選擇金流" /></SelectTrigger>
              <SelectContent>
                {addGroup === 'credit' ? (
                  <>
                    <SelectItem value="ecpay">綠界 ECPay</SelectItem>
                    <SelectItem value="acpay">ACpay</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="newebpay">藍新 NewebPay</SelectItem>
                    <SelectItem value="line_pay">LINE Pay</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>顯示名稱</Label>
            <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="例：主要金流" />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={onAdd}>新增</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
