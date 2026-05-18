import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdvisor: boolean;
  billingCycle: 'monthly' | 'yearly';
  consentChecked: boolean;
  setConsentChecked: (v: boolean) => void;
  onProceed: () => void;
}

/**
 * Checkout consent dialog (terms + risk disclosure).
 *
 * Extracted from `Checkout.tsx` to keep the container under control. The legal
 * copy below is regulated content — edits MUST go through legal review.
 * See [Checkout consent](mem://features/subscription/checkout-consent-flow).
 */
export function CheckoutConsentDialog({
  open,
  onOpenChange,
  isAdvisor,
  billingCycle,
  consentChecked,
  setConsentChecked,
  onProceed,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isAdvisor ? '跟單派使用者條款與風險揭露' : '修煉派使用者條款與學習聲明'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 max-h-[60vh] pr-4">
          <div className="prose prose-sm dark:prose-invert text-sm space-y-4">
            {isAdvisor ? <AdvisorTerms /> : <MentorTerms />}
          </div>
        </ScrollArea>
        <div className="border-t pt-4 space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>單次扣款說明</strong>：本平台採單次手動扣款，不會自動續訂。
            效期 {billingCycle === 'monthly' ? '1 個月' : '1 年'} 到期後立即停權，
            無寬限期。如需延續服務，請於到期前自行重新付款。
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={consentChecked}
              onCheckedChange={(checked) => setConsentChecked(checked === true)}
              className="mt-0.5"
            />
            <span className="text-sm leading-relaxed">
              {isAdvisor
                ? '我已閱讀並同意以上條款，理解「單次扣款、到期停權、不會自動續訂」，並願意自行承擔所有投資風險後使用「跟單派」服務'
                : '我已閱讀並同意以上條款，理解「單次扣款、到期停權、不會自動續訂」，並理解「學習不等於保證成果」後使用「修煉派」服務'}
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button
              className={cn(isAdvisor ? '' : 'bg-mentor hover:bg-mentor-dark')}
              disabled={!consentChecked}
              onClick={onProceed}
            >
              同意並前往付款
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdvisorTerms() {
  return (
    <>
      <p>在訂閱「跟單派」服務前，請詳閱以下內容。</p>
      <p>當你勾選同意並開始使用本服務，即視為你已充分理解並接受本條款之全部內容。</p>

      <h4 className="font-semibold mt-4">一、服務性質說明</h4>
      <p>「跟單派」提供即時訊號、交易觀察、進出場紀錄、操作邏輯摘要及市場資訊整理。</p>
      <p>本服務之目的在於協助使用者提升資訊取得效率，而非提供投資建議。</p>
      <p>本服務不構成：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>投資建議</li>
        <li>投資顧問服務</li>
        <li>代操或資產管理服務</li>
        <li>任何形式之收益或保本承諾</li>
      </ul>
      <p>使用者應依自身之資金狀況、風險承受能力及投資判斷，自行決定是否採取任何交易行為。</p>

      <h4 className="font-semibold mt-4">二、結果差異說明</h4>
      <p>即使參考相同之交易訊號，實際投資結果仍可能產生顯著差異，包括但不限於：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>訊號接收時間差異</li>
        <li>下單價格與成交條件不同</li>
        <li>部位規模與資金配置差異</li>
        <li>停損、停利及加減碼策略不同</li>
        <li>市場波動及流動性變化</li>
        <li>使用者執行紀律與決策差異</li>
      </ul>
      <p>因此，本服務所提供之資訊，不應被視為可複製之投資成果。</p>

      <h4 className="font-semibold mt-4">三、風險揭露</h4>
      <p>所有投資行為均涉及風險，包括但不限於：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>本金損失風險</li>
        <li>市場波動風險</li>
        <li>個別標的突發事件風險</li>
        <li>流動性風險</li>
        <li>價格滑價與執行落差</li>
        <li>使用者判斷錯誤之風險</li>
      </ul>
      <p>過往績效、歷史紀錄、案例展示或任何形式之數據分析，均不代表未來表現。</p>

      <h4 className="font-semibold mt-4">四、責任界線</h4>
      <p>使用本服務，即表示使用者確認並同意：</p>
      <ol className="list-decimal pl-5 space-y-1">
        <li>本平台僅提供資訊，不對任何投資結果作出保證。</li>
        <li>所有交易決策由使用者自行獨立作出。</li>
        <li>因使用本服務所產生之一切損益結果，均由使用者自行承擔。</li>
        <li>本平台及相關內容提供者，不對任何直接或間接之損失負責。</li>
      </ol>

      <h4 className="font-semibold mt-4">五、非個人化聲明</h4>
      <p>本服務未針對個別使用者之財務狀況、投資目標或風險承受能力提供個人化建議。</p>
      <p>使用者不得將本平台內容視為適用於其個人情境之投資依據。</p>

      <h4 className="font-semibold mt-4">六、即時性與技術限制</h4>
      <p>本服務可能涉及即時通知與資料更新，但不保證：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>訊號即時送達</li>
        <li>資料同步無延遲</li>
        <li>系統持續穩定運作</li>
      </ul>
      <p>使用者應理解，技術性延遲、網路狀況或第三方服務限制，均可能影響資訊呈現。</p>

      <h4 className="font-semibold mt-4">七、適用對象</h4>
      <p>本服務適用於具備以下條件之使用者：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>已理解投資風險之存在</li>
        <li>能自行判斷與承擔投資決策後果</li>
        <li>不以本服務作為唯一決策依據</li>
      </ul>
      <p>若使用者期待保證收益、固定報酬或完全複製績效，本服務不適用。</p>

      <h4 className="font-semibold mt-4">八、使用規範</h4>
      <p>使用者不得：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>未經授權轉載、轉售或散布本平台內容</li>
        <li>冒用他人身分使用服務</li>
        <li>將平台內容對外宣稱為投資建議或招攬工具</li>
        <li>從事任何違法或不當用途</li>
      </ul>
      <p>違反者，平台有權終止服務且不另行退費。</p>

      <h4 className="font-semibold mt-4">九、服務調整</h4>
      <p>本平台得依營運需求調整服務內容、功能或條款，並保留修改或終止部分服務之權利。</p>

      <h4 className="font-semibold mt-4">十、最終確認</h4>
      <p>在使用本服務前，請確認：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>已理解本服務不構成投資建議</li>
        <li>已理解投資結果具有不確定性</li>
        <li>已理解所有決策與風險由本人承擔</li>
      </ul>
    </>
  );
}

function MentorTerms() {
  return (
    <>
      <p>在訂閱「修煉派」服務前，請詳閱以下內容。</p>
      <p>當你勾選同意並開始使用本服務，即視為你已充分理解並接受本條款之全部內容。</p>

      <h4 className="font-semibold mt-4">一、服務性質說明</h4>
      <p>「修煉派」提供交易紀錄、操作思路拆解、策略邏輯說明及相關市場觀察。</p>
      <p>本服務之目的在於協助使用者理解交易方法與決策過程，而非提供即時操作指引。</p>
      <p>本服務不構成：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>投資建議</li>
        <li>投資顧問服務</li>
        <li>即時進出場指示</li>
        <li>任何形式之收益或績效保證</li>
      </ul>
      <p>使用者應將本服務視為學習與參考資料，而非直接操作依據。</p>

      <h4 className="font-semibold mt-4">二、學習與結果差異</h4>
      <p>理解交易方法與實際獲得投資成果，屬於不同層次之能力。</p>
      <p>即使使用者已閱讀或理解相關內容，其實際操作結果仍可能產生顯著差異，原因包括但不限於：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>對策略理解程度不同</li>
        <li>市場環境變化（與原案例不同）</li>
        <li>資金規模與風險承受能力差異</li>
        <li>操作節奏與執行紀律不同</li>
        <li>情緒管理與決策偏差</li>
      </ul>
      <p>因此，本服務所提供之內容，不應被視為可直接複製之投資成果或操作方法。</p>

      <h4 className="font-semibold mt-4">三、風險揭露</h4>
      <p>使用本服務進行學習與後續實際交易，仍涉及投資風險，包括但不限於：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>本金損失風險</li>
        <li>市場波動風險</li>
        <li>策略失效或不適用之風險</li>
        <li>使用者理解錯誤或應用不當之風險</li>
      </ul>
      <p>過往案例、紀錄、分析內容或方法說明，均不代表未來市場情況或個人結果。</p>

      <h4 className="font-semibold mt-4">四、責任界線</h4>
      <p>使用本服務，即表示使用者確認並同意：</p>
      <ol className="list-decimal pl-5 space-y-1">
        <li>本平台僅提供學習與資訊內容，不對任何投資結果作出保證。</li>
        <li>使用者對於內容之理解、應用與轉化，均屬個人行為。</li>
        <li>所有實際交易決策與其結果，均由使用者自行負責。</li>
        <li>本平台及相關內容提供者，不對任何直接或間接之損失負責。</li>
      </ol>

      <h4 className="font-semibold mt-4">五、非個人化聲明</h4>
      <p>本服務未針對個別使用者之財務狀況、投資目標或風險承受能力提供個人化建議。</p>
      <p>所有內容僅為一般性觀點與方法分享，不應被視為適用於特定個人之策略。</p>

      <h4 className="font-semibold mt-4">六、內容性質與限制</h4>
      <p>本服務所提供之交易紀錄、案例與策略說明：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>可能來自特定時間點之市場條件</li>
        <li>不保證在未來市場中持續有效</li>
        <li>不代表完整策略或所有決策細節</li>
      </ul>
      <p>使用者應理解，任何策略或方法均存在適用範圍與限制。</p>

      <h4 className="font-semibold mt-4">七、適用對象</h4>
      <p>本服務適用於：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>希望建立自身交易邏輯與判斷能力之使用者</li>
        <li>能接受學習過程需要時間與反覆驗證</li>
        <li>能承擔策略嘗試與調整過程中的損益波動</li>
      </ul>
      <p>若使用者期待：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>立即可用之操作指引</li>
        <li>穩定或可預測之投資成果</li>
        <li>無需理解即可套用之方法</li>
      </ul>
      <p>則本服務不適用。</p>

      <h4 className="font-semibold mt-4">八、使用規範</h4>
      <p>使用者不得：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>未經授權轉載、轉售或散布本平台內容</li>
        <li>將平台內容包裝為個人投資建議對外提供</li>
        <li>誤導他人認為本服務可保證成果</li>
        <li>從事任何違法或不當用途</li>
      </ul>
      <p>違反者，平台有權終止服務且不另行退費。</p>

      <h4 className="font-semibold mt-4">九、服務調整</h4>
      <p>本平台得依營運需求調整內容形式、策略分享方式或服務範圍，並保留修改或終止部分服務之權利。</p>

      <h4 className="font-semibold mt-4">十、最終確認</h4>
      <p>在使用本服務前，請確認：</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>已理解本服務屬於學習性質，而非操作指引</li>
        <li>已理解方法學習不等於可直接複製成果</li>
        <li>已理解所有決策與風險由本人承擔</li>
      </ul>
    </>
  );
}
