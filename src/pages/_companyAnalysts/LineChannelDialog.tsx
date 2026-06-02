import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { useLineChannelEditor } from '@/hooks/company/useLineChannelEditor';

type Editor = ReturnType<typeof useLineChannelEditor>;

export function LineChannelDialog({ editor }: { editor: Editor }) {
  const {
    lineExpertId, lineExpertName, lineChannel, lineLoading, savingLine, lineBindingsCount,
    lineChannelId, setLineChannelId,
    lineToken, setLineToken,
    lineChannelName, setLineChannelName,
    lineOaId, setLineOaId,
    lineQrCodeUrl, setLineQrCodeUrl,
    lineActive, setLineActive,
    closeLineSettings, handleSaveLine,
  } = editor;

  return (
    <Dialog open={!!lineExpertId} onOpenChange={(open) => { if (!open) closeLineSettings(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{lineExpertName} — LINE 設定</DialogTitle>
        </DialogHeader>
        {lineLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">載入中...</p>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Channel ID</Label>
              <Input value={lineChannelId} onChange={e => setLineChannelId(e.target.value)} placeholder="LINE Channel ID" />
            </div>
            <div className="space-y-2">
              <Label>Channel Access Token</Label>
              <Input value={lineToken} onChange={e => setLineToken(e.target.value)} placeholder="長期 Channel Access Token" type="password" />
            </div>
            <div className="space-y-2">
              <Label>顯示名稱（選填）</Label>
              <Input value={lineChannelName} onChange={e => setLineChannelName(e.target.value)} placeholder="例：趙鵬博｜訊號通知" />
            </div>
            <div className="space-y-2">
              <Label>Bot Basic ID</Label>
              <Input value={lineOaId} onChange={e => setLineOaId(e.target.value)} placeholder="例：@zhao-pengbo" />
              <p className="text-xs text-muted-foreground">訂閱者透過此 ID 搜尋並加入官方帳號</p>
            </div>
            <div className="space-y-2">
              <Label>QR Code 網址</Label>
              <Input value={lineQrCodeUrl} onChange={e => setLineQrCodeUrl(e.target.value)} placeholder="https://qr-official.line.me/..." />
              <p className="text-xs text-muted-foreground">訂閱者可掃描 QR Code 加入官方帳號</p>
            </div>
            <div className="flex items-center justify-between">
              <Label>啟用推播</Label>
              <Switch checked={lineActive} onCheckedChange={setLineActive} />
            </div>
            <div className="text-xs text-muted-foreground">
              已綁定訂閱者：{lineBindingsCount} 人
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={closeLineSettings}>取消</Button>
              <Button onClick={handleSaveLine} disabled={savingLine}>
                {savingLine ? '儲存中...' : lineChannel ? '更新設定' : '儲存設定'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
