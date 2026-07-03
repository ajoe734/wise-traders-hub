import { SEO } from '@/components/SEO';
import { Link, useNavigate } from 'react-router-dom';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { User, MessageCircle, Calendar, ExternalLink, Radio, Settings, Loader2 } from 'lucide-react';
import { useAccountData } from '@/hooks/app/useAccountData';
import { SubscriptionCard } from '@/pages/_appAccount/SubscriptionCard';
import { LinePartySection } from '@/pages/_appAccount/LinePartySection';
import { FreeCheckupQuotaCard } from '@/pages/_appAccount/FreeCheckupQuotaCard';
import { PredictEventsCard } from '@/pages/_appAccount/PredictEventsCard';
import { PendingCheckoutCard } from '@/pages/_appAccount/PendingCheckoutCard';
import { RenewalBanner } from '@/components/account/RenewalBanner';
import { AccountLinkCard } from '@/pages/_appAccount/AccountLinkCard';
import { SubscriptionConflictNotice } from '@/components/account/SubscriptionConflictNotice';


const Account = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const {
    subscriptions, loadingSubs, cancelingId,
    pendingRemitCount, subscribedExpertIds,
    allAdvisors, allMentors,
    handleCancelSubscription,
  } = useAccountData();

  const nowMs = Date.now();
  const activeSubs = subscriptions.filter(s =>
    s.status === 'active' && (!s.expires_at || new Date(s.expires_at).getTime() > nowMs)
  );

  return (
    <UnifiedAppLayout>
      <SEO title="會員帳號 | legendflow" description="管理 legendflow 訂閱、Line 綁定、免費診斷額度與帳號設定。" path="/app/account" noindex />
      <div className="p-4 space-y-6">
        <h1 className="text-xl font-bold">帳號設定</h1>

        <RenewalBanner />
        <SubscriptionConflictNotice />
        <PendingCheckoutCard />




        {pendingRemitCount > 0 && (
          <Card className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">您有 {pendingRemitCount} 筆匯款訂單尚未補齊資料</p>
                <p className="text-muted-foreground mt-0.5">補填末五碼與匯款人姓名，後台才能為您對帳開通。</p>
              </div>
              <Button size="sm" onClick={() => navigate('/account/remittance', { state: { from: { pathname: '/app/account', search: '' } } })}>前往補填</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="頭貼" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-6 w-6 text-primary" />
                )}
              </div>
              <div>
                <p className="font-semibold">{user?.displayName || '會員'}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <FreeCheckupQuotaCard />
        <PredictEventsCard />

        <AccountLinkCard />


        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            我的訂閱
          </h2>

          {loadingSubs ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeSubs.length > 0 ? (
            <div className="space-y-3">
              {activeSubs.map((sub) => (
                <SubscriptionCard key={sub.id} sub={sub} cancelingId={cancelingId} onCancel={handleCancelSubscription} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Radio className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p>尚無訂閱</p>
              </CardContent>
            </Card>
          )}
        </div>

        {!user?.isLineUser && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <Link to="/account/profile" className="flex items-center justify-between p-2 rounded-lg hover:bg-muted transition-colors">
                <span className="text-sm flex items-center gap-2">
                  <Settings className="h-4 w-4" /> 編輯個人資料
                </span>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            LINE 綁定
            <span className="font-normal text-muted-foreground">（請先訂閱）</span>
          </h2>
          <p className="text-sm text-muted-foreground">綁定 LINE 後，可即時收到訊號推播或週記通知</p>
          <div className="space-y-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <p className="font-medium text-foreground text-sm">綁定步驟：</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>查看所有老師</li>
              <li>加入官方帳號</li>
              <li>點擊右側按鈕取得驗證碼</li>
              <li>在 LINE 聊天中傳送驗證碼</li>
              <li>收到綁定成功通知即完成</li>
            </ol>
          </div>

          <div className="space-y-3">
            <LinePartySection
              title="跟單派"
              subtitle="即時訊號推播通知"
              experts={allAdvisors}
              subscribedExpertIds={subscribedExpertIds}
              variant="advisor"
            />
          </div>

          <div className="space-y-3">
            <LinePartySection
              title="修煉派"
              subtitle="每週實戰週記通知"
              experts={allMentors}
              subscribedExpertIds={subscribedExpertIds}
              variant="mentor"
            />
          </div>
        </div>
      </div>
    </UnifiedAppLayout>
  );
};

export default Account;
