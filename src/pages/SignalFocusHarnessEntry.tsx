// @ts-nocheck
/**
 * Preview-only harness：SignalCreateDialog 的按鍵焦點 / 字級 / 直橫切換合約
 *
 * 1:1 複刻 SignalCreateDialog 中所有 focusable 元件與 CSS：
 *   - DialogContent 外容器樣式（max-h + landscape max-h + w calc）
 *   - overflow-y-auto flex-1 min-h-0 scroll wrapper（p-1 -m-1）
 *   - Input / Textarea / Select / Button（含模板小按鈕 group）
 *   - 底部固定 justify-end 取消/發布 按鈕列
 *
 * Playwright 依此驗證：
 *   a. Input/Textarea computed fontSize ≥ 16px（防 iOS 自動 zoom）
 *   b. focus 後 outline 或 box-shadow ring 可見（非 'none'）
 *   c. focused 元素完整在 scroll container 可視範圍內
 *   d. 相鄰模板按鈕 focus ring 不重疊
 *   e. 橫豎切換後上述 a-d 全通過
 */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

const TEMPLATES = ['買進策略A', '賣出停利', '加碼B', '減碼C', '出場D', '長線持有'];

export default function SignalFocusHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');

  return (
    <div
      id="signal-focus-harness-root"
      style={{ minHeight: '100vh', padding: 0, background: '#eee' }}
    >
      {/* 1:1 複刻 SignalCreateDialog.tsx L296-310 的 DialogContent 骨架 */}
      <div
        data-testid="signal-create-dialog"
        className={cn(
          'mx-auto bg-background border shadow-lg rounded-md p-6',
          'w-[calc(100vw-1rem)] max-w-lg max-h-[90dvh] landscape:max-h-[95dvh] flex flex-col',
        )}
      >
        <div className="flex items-center gap-2 pb-3 border-b">
          <h2 className="text-base font-semibold">發布新訊號</h2>
        </div>
        <div
          data-testid="signal-create-scroll"
          className="space-y-4 mt-4 overflow-y-auto flex-1 min-h-0 p-1 -m-1 overscroll-contain"
        >
          <div className="space-y-2">
            <Label>股票代碼</Label>
            <Input
              data-testid="f-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="2330"
            />
          </div>
          <div className="space-y-2">
            <Label>股票名稱</Label>
            <Input
              data-testid="f-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">訊號模板</Label>
            <div
              data-testid="signal-template-group"
              className="flex flex-wrap gap-x-1.5 gap-y-2 max-h-16 overflow-y-auto p-0.5 -m-0.5"
            >
              {TEMPLATES.map((t, i) => (
                <Button
                  key={t}
                  data-testid={`f-tpl-${i}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2"
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>參考價位</Label>
            <Input
              data-testid="f-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              step="0.01"
            />
          </div>
          <div className="space-y-2">
            <Label>數量</Label>
            <Input
              data-testid="f-qty"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              type="number"
              step="1"
            />
          </div>
          <div className="space-y-2">
            <Label>操作理由</Label>
            <Textarea
              data-testid="f-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>策略詳述</Label>
            <Textarea
              data-testid="f-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-3 border-t">
          <Button data-testid="f-cancel" variant="outline">
            取消
          </Button>
          <Button data-testid="f-publish">立即發布</Button>
        </div>
      </div>
    </div>
  );
}
