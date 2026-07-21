import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatFailure } from '@/lib/functionError';
import { Mail, Key, Send } from 'lucide-react';
import type { useAnalystAccount } from '@/hooks/company/useAnalystAccount';

type Account = ReturnType<typeof useAnalystAccount>;

export function AccountCredentialsDialog({ account }: { account: Account }) {
  const {
    acctExpert, acctTab, setAcctTab,
    acctCurrentEmail, acctIsLineVirtual, acctLoading, acctError,
    acctNewEmail, setAcctNewEmail,
    acctNewPassword, setAcctNewPassword,
    acctConfirmPassword, setAcctConfirmPassword,
    acctSubmitting,
    closeAccountDialog,
    handleUpdateEmail, handleResetPassword, handleSendResetEmail,
  } = account;

  return (
    <Dialog open={!!acctExpert} onOpenChange={(open) => { if (!open) closeAccountDialog(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{acctExpert?.name} — 帳號設定</DialogTitle>
          <DialogDescription>
            目前 Email：<span className="font-mono">{acctLoading ? '載入中...' : acctCurrentEmail || '—'}</span>
            {acctIsLineVirtual && <span className="block mt-1 text-amber-500">⚠ 此帳號透過 LINE 登入，僅可重設密碼</span>}
          </DialogDescription>
        </DialogHeader>

        {acctError && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>
              <span className="block">{formatFailure(acctError)}</span>
              {acctError.detail && <span className="mt-1 block text-xs opacity-80 break-words">{acctError.detail}</span>}
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={acctTab} onValueChange={(v) => setAcctTab(v as any)} className="mt-2">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="email" disabled={acctIsLineVirtual}><Mail className="h-3 w-3 mr-1" />改 Email</TabsTrigger>
            <TabsTrigger value="password"><Key className="h-3 w-3 mr-1" />重設密碼</TabsTrigger>
            <TabsTrigger value="reset" disabled={acctIsLineVirtual}><Send className="h-3 w-3 mr-1" />寄重設信</TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="analyst-account-new-email">新 Email</Label>
              <Input
                id="analyst-account-new-email"
                type="email"
                value={acctNewEmail}
                onChange={(e) => setAcctNewEmail(e.target.value)}
                placeholder="new@example.com"
                disabled={acctIsLineVirtual}
              />
              <p className="text-xs text-muted-foreground">更新後該分析師需以新 Email 登入。系統會自動標記新 Email 為已驗證。</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeAccountDialog}>取消</Button>
              <Button onClick={handleUpdateEmail} disabled={acctSubmitting || acctIsLineVirtual}>
                {acctSubmitting ? '更新中...' : '更新 Email'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="password" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="analyst-account-new-password">新密碼</Label>
              <Input
                id="analyst-account-new-password"
                type="password"
                value={acctNewPassword}
                onChange={(e) => setAcctNewPassword(e.target.value)}
                placeholder="至少 8 碼，需含英文與數字"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analyst-account-confirm-password">確認新密碼</Label>
              <Input
                id="analyst-account-confirm-password"
                type="password"
                value={acctConfirmPassword}
                onChange={(e) => setAcctConfirmPassword(e.target.value)}
                placeholder="再次輸入"
              />
            </div>
            <p className="text-xs text-muted-foreground">立即覆蓋密碼。請務必透過安全管道告知該分析師。</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeAccountDialog}>取消</Button>
              <Button onClick={handleResetPassword} disabled={acctSubmitting}>
                {acctSubmitting ? '處理中...' : '立即重設'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="reset" className="space-y-4 mt-4">
            <p className="text-sm">
              系統將寄出含一次性重設連結的郵件至：
              <span className="block mt-1 font-mono text-foreground">{acctCurrentEmail || '—'}</span>
            </p>
            <p className="text-xs text-muted-foreground">分析師收到信後，可自行設定新密碼（連結 60 分鐘內有效）。</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeAccountDialog}>取消</Button>
              <Button onClick={handleSendResetEmail} disabled={acctSubmitting || acctIsLineVirtual || !acctCurrentEmail}>
                {acctSubmitting ? '寄送中...' : '發送重設密碼信'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
