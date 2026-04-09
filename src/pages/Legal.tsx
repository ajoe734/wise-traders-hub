import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, AlertTriangle, Clock, Lock } from 'lucide-react';

const Legal = () => {
  return (
    <PortalLayout>
      <div className="container py-8 md:py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-2xl md:text-3xl font-bold mb-4">法律聲明與服務說明</h1>
          <p className="text-muted-foreground max-w-3xl">
            我們重視合規經營與資訊透明。以下說明本平台的服務性質、法規遵循與風險揭露。
          </p>
        </div>

        <div className="max-w-4xl space-y-8">
          {/* Investment Advisory Service */}
          <Card className="dark:border-white/10">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-advisor-light dark:bg-advisor/20 dark:ring-1 dark:ring-advisor/30 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-advisor" />
                </div>
                <CardTitle>投顧分析師服務說明</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                本平台的「投顧分析師」服務係指由持有證券投資顧問事業營業執照之專業分析師所提供的投資顧問服務。
              </p>
              <h4 className="text-foreground">服務內容包含：</h4>
              <ul>
                <li>即時投資策略訊號（包含具體買賣建議）</li>
                <li>每筆操作的教學說明（風險評估、部位控管、操作邏輯）</li>
                <li>進階方案另包含持股健檢報告</li>
              </ul>
              <h4 className="text-foreground">法規遵循：</h4>
              <ul>
                <li>本服務依據「證券投資顧問事業管理規則」辦理</li>
                <li>提供服務之分析師均持有合法執照</li>
                <li>所有投資建議均經內部合規審查</li>
              </ul>
            </CardContent>
          </Card>

          {/* Mentor Teaching Service */}
          <Card className="dark:border-white/10">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-mentor-light dark:bg-mentor/20 dark:ring-1 dark:ring-mentor/30 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-mentor" />
                </div>
                <CardTitle>實戰導師教學服務說明</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                本平台的「實戰導師」服務為純教學性質，所有內容由導師於每週六發布，
                僅作為歷史案例教學之用途。
              </p>
              <h4 className="text-foreground">服務特性：</h4>
              <ul>
                <li>每週六由導師發布操作回顧週記</li>
                <li>不提供即時投資建議或策略訊號</li>
                <li>不提供個別持股診斷或投資組合建議</li>
                <li>內容僅供歷史案例學習與風險思維教育</li>
              </ul>
              <h4 className="text-foreground">重要聲明：</h4>
              <p>
                實戰導師服務不構成證券投資顧問服務，所提供之內容均為歷史資料回顧，
                不應作為即時投資決策之依據。投資人應自行判斷並承擔投資風險。
              </p>
            </CardContent>
          </Card>

          {/* Risk Disclosure */}
          <Card className="dark:border-white/10">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-warning-light dark:bg-warning/20 dark:ring-1 dark:ring-warning/30 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                </div>
                <CardTitle>風險揭露</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p className="font-medium text-foreground">
                投資一定有風險，過去的績效不代表未來的表現。
              </p>
              <h4 className="text-foreground">投資人應注意：</h4>
              <ul>
                <li>證券投資具有價格波動風險，可能導致本金損失</li>
                <li>任何投資建議或分析意見僅供參考，不保證獲利</li>
                <li>投資人應根據自身風險承受能力、投資經驗與財務狀況，審慎評估後再做決定</li>
                <li>不同的投資商品有不同的風險特性，投資前應詳閱相關說明文件</li>
              </ul>
              <h4 className="text-foreground">特別提醒：</h4>
              <ul>
                <li>切勿以借貸資金進行投資</li>
                <li>勿將全部資產集中於單一投資標的</li>
                <li>定期檢視投資組合，適時調整配置</li>
              </ul>
            </CardContent>
          </Card>

          {/* Privacy */}
          <Card className="dark:border-white/10">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 dark:bg-primary/20 dark:ring-1 dark:ring-primary/30 flex items-center justify-center">
                  <Lock className="h-5 w-5 text-primary" />
                </div>
                <CardTitle>隱私權與資料保護</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                我們重視您的隱私權與個人資料保護。
              </p>
              <h4 className="text-foreground">資料收集與使用：</h4>
              <ul>
                <li>我們僅收集提供服務所必要的個人資料</li>
                <li>您的資料將依據個人資料保護法相關規定妥善保管</li>
                <li>未經您的同意，我們不會將您的資料提供給第三方</li>
              </ul>
              <h4 className="text-foreground">資料安全：</h4>
              <ul>
                <li>採用業界標準的加密技術保護您的資料</li>
                <li>定期進行安全性評估與更新</li>
                <li>員工均簽署保密協議</li>
              </ul>
            </CardContent>
          </Card>

          {/* Contact */}
          <Card className="bg-muted/30 dark:bg-white/[0.03] dark:border-white/10">
            <CardContent className="p-6">
              <h3 className="font-semibold mb-2">聯絡我們</h3>
              <p className="text-sm text-muted-foreground mb-4">
                如有任何問題或建議，歡迎透過以下方式聯繫：
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>公司名稱：海洋福星生物科技股份有限公司</li>
                <li>統一編號：83479669</li>
                <li>服務時間：週一至週五 09:00-18:00</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
};

export default Legal;
