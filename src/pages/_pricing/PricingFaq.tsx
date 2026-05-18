import { Card, CardContent } from '@/components/ui/card';

const FAQS = [
  {
    q: '跟單派和修煉派有什麼不同？',
    a: '跟單派提供即時訊號，適合想直接跟著操作的人。修煉派則專注於教學，用上週的真實案例幫你理解決策邏輯，適合想培養自己判斷力的人。',
  },
  {
    q: '健檢交付形式是什麼？多久拿到？',
    a: '健檢報告會以 PDF 形式透過 Line 或 Email 寄送，通常在提交資料後 3 個工作天內完成。',
  },
  {
    q: '健檢可以買幾次？',
    a: '只要你的跟單派訂閱還在有效期間內，就可以隨時加購。每次加購都是獨立的單次服務，沒有次數限制。',
  },
  {
    q: '我該選哪一派？',
    a: '如果你時間有限、想省去選股研究的功夫，選跟單派。如果你想慢慢建立自己的交易系統、願意花時間學習，選修煉派。',
  },
  {
    q: '可以隨時取消訂閱嗎？',
    a: '是的，您可以隨時取消訂閱。取消後，您仍可使用服務至當期結束。',
  },
  {
    q: '訊號會透過什麼方式通知？',
    a: '目前訊號會顯示在會員 app 的「即時訊號牆」中。未來我們將支援 LINE 推播通知。',
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
