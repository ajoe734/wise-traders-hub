import { Card, CardContent } from '@/components/ui/card';

const FAQS = [
  {
    q: '跟單派和修煉派有什麼不同？',
    a: '跟單派提供即時訊號，適合想直接跟著操作的人。修煉派是每週固定公開的「當週操作復盤 ＋ 下週觀察框架」，用真實案例說明判斷依據，適合想培養自己判斷力的人；內容為教學研究用途，非買賣建議。',
  },
  {
    q: '健檢交付形式是什麼？多久拿到？',
    a: '健檢報告會以 PDF 形式透過 Line 或 Email 寄送，通常在提交資料後 3 個工作天內完成。',
  },
  {
    q: '健檢需要先訂閱老師嗎？可以用幾次？',
    a: '不需要。持股健檢可獨立訂閱，不必綁定任何老師；使用次數依你所選的健檢方案每月額度計算，額度可在會員頁查看。',
  },
  {
    q: '我該選哪一派？',
    a: '如果你時間有限、想省去選股研究的功夫，選跟單派。如果你想慢慢建立自己的交易系統、願意花時間讀每週復盤與觀察框架，選修煉派。',
  },
  {
    q: '可以隨時取消訂閱嗎？',
    a: '是的，您可以隨時取消訂閱。取消後，您仍可使用服務至當期結束。',
  },
  {
    q: '訊號會透過什麼方式通知？',
    a: '訊號會即時顯示在會員 app 的「即時訊號牆」；若你的帳號已綁定本站 LINE 官方帳號，同一則訊號也會以 LINE 推播送達。',
  },
];

export function PricingFaq() {
  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-xl font-bold mb-6 text-center">常見問題</h2>
      <div className="space-y-4">
        {FAQS.map((faq, idx) => (
          <Card key={idx}>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-2">{faq.q}</h3>
              <p className="text-sm text-muted-foreground">{faq.a}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
