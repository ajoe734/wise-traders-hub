/**
 * P0_UNPUBLISHED_JOURNAL_EDIT_ISOLATION_V1 — 前端接線 render/integration 測試
 *
 * 鎖住合約：
 *  A. pending mentor 編輯（available_cash=0、無持倉）：改標題與參考價 → 呼叫
 *     update_pending_mentor_journal_batch 一次且 payload 是新值；
 *     save_signal_batch / functions.invoke / reloadCapital 均 0 次。
 *  B. 參考價 <= 0 或必填欄位缺失 → 不呼叫任何 RPC。
 *  C. published mentor batch → 不走 content-only RPC（維持 save_signal_batch 原流程）。
 *  D. advisor / 新建 mentor 週記 → 仍走 save_signal_batch。
 *  E. RPC missing / not_pending → 顯示可理解錯誤，輸入值仍留在畫面。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import type { TradeDraft } from '@/pages/_signalEditor/types';

const rpc = vi.fn();
const invoke = vi.fn();
const reloadCapital = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    functions: { invoke: (...a: any[]) => invoke(...a) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...a: any[]) => toastError(...a),
    success: (...a: any[]) => toastSuccess(...a),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', expertSlug: 'sharkgu' }, hasRole: () => false }),
}));

vi.mock('@/components/layouts/AdminLayout', () => ({
  AdminLayout: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/admin/ExpiringSubscribersBanner', () => ({
  ExpiringSubscribersBanner: () => null,
}));
vi.mock('@/components/admin/LazyRichTextEditor', () => ({
  LazyRichTextEditor: ({ value }: any) => <div data-testid="rte">{value || ''}</div>,
}));
vi.mock('@/components/SEO', () => ({ SEO: () => null }));
vi.mock('@/pages/_signalEditor/JournalPreviewDialog', () => ({
  JournalPreviewDialog: () => null,
}));

/** 測試 fixture：由每個案例設定 */
let fixture: {
  role: 'mentor' | 'advisor';
  status: string | null;
  isEditing: boolean;
};

const ROW_ID = '11111111-1111-4111-8111-111111111111';

function makeTrade(): TradeDraft {
  return {
    uid: ROW_ID,
    executedAt: '2026-09-10T10:00',
    stockCode: '2330',
    stockName: '台積電',
    action: 'buy' as any,
    priceHint: '890',
    quantity: '1',
    quantityUnit: '張',
    reasonSummary: '測試',
    reasonDetail: '',
    riskNotes: '',
  } as TradeDraft;
}

vi.mock('@/hooks/admin/useSignalEditorData', () => ({
  useSignalEditorData: ({ isEditing, onBatchLoaded }: any) => {
    useEffect(() => {
      if (!isEditing) return;
      onBatchLoaded({
        teachingTopic: '舊標題',
        overallSummary: '',
        learningPoints: '',
        trades: [makeTrade()],
        publishedAt: null,
        createdAt: '2026-09-10T00:00:00Z',
        status: fixture.status,
      });
      // 只在掛載時 hydrate 一次
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return {
      expert: {
        id: 'e1', slug: 'sharkgu', role: fixture.role,
        asset_class: 'tw_stock', currency: 'TWD', user_id: 'u1',
      },
      signalTemplates: [],
      openPositions: [],
      capital: {
        starting_capital: 1_000_000,
        realized_pnl_amount: 0,
        open_cost_value: 0,
        open_market_value: 0,
        unrealized_pnl_amount: 0,
        available_cash: 0,
        open_positions: [],
        recent_trades: [],
      },
      currency: 'TWD',
      loading: false,
      setCapital: () => {},
      reloadCapital,
    };
  },
}));

// eslint-disable-next-line import/first
import SignalEditor from '@/pages/admin/SignalEditor';

function renderEditor(editing: boolean) {
  const path = editing
    ? '/admin/sharkgu/signals/edit/22222222-2222-4222-8222-222222222222'
    : '/admin/sharkgu/signals/new';
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/:expertSlug/signals/edit/:batchId" element={<SignalEditor />} />
        <Route path="/admin/:expertSlug/signals/new" element={<SignalEditor />} />
        <Route path="/admin/:expertSlug/signals" element={<div>list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const topicInput = () => screen.getByPlaceholderText(/本週主題/) as HTMLInputElement;
const priceInput = () => screen.getByPlaceholderText('890') as HTMLInputElement;
const SUBMIT_LABELS = ['更新週記', '更新', '儲存週記', '立即發布'];
const submit = () => {
  const btns = screen.getAllByRole('button')
    .filter((b) => SUBMIT_LABELS.includes((b.textContent || '').trim()));
  if (btns.length === 0) throw new Error('找不到送出按鈕');
  return btns[0];
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  invoke.mockReset().mockResolvedValue({ data: null, error: null });
  reloadCapital.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  localStorage.clear();
  fixture = { role: 'mentor', status: 'pending', isEditing: true };
});

describe('A. pending mentor 內容更新', () => {
  it('改標題與參考價後只呼叫專用 RPC，payload 是新值，且不碰帳本', async () => {
    renderEditor(true);
    await waitFor(() => expect(topicInput().value).toBe('舊標題'));

    fireEvent.change(topicInput(), { target: { value: '新標題 — 停利紀律' } });
    fireEvent.change(priceInput(), { target: { value: '1234' } });
    expect(topicInput().value).toBe('新標題 — 停利紀律');

    fireEvent.click(submit());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    const [fn, payload] = rpc.mock.calls[0];
    expect(fn).toBe('update_pending_mentor_journal_batch');
    expect(payload._expert_id).toBe('e1');
    expect(payload._batch_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(payload._rows).toHaveLength(1);
    expect(payload._rows[0].id).toBe(ROW_ID);
    expect(payload._rows[0].teaching_topic).toBe('新標題 — 停利紀律');
    expect(payload._rows[0].price_hint).toBe(1234);

    expect(rpc.mock.calls.some(([n]) => n === 'save_signal_batch')).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(reloadCapital).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });
});

describe('B. 內容驗證仍生效', () => {
  it('參考價 <= 0 不呼叫任何 RPC', async () => {
    renderEditor(true);
    await waitFor(() => expect(topicInput().value).toBe('舊標題'));
    fireEvent.change(priceInput(), { target: { value: '0' } });
    fireEvent.click(submit());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(rpc).not.toHaveBeenCalled();
  });

  it('股票代碼清空不呼叫任何 RPC', async () => {
    renderEditor(true);
    await waitFor(() => expect(topicInput().value).toBe('舊標題'));
    const code = screen.getByDisplayValue('2330');
    fireEvent.change(code, { target: { value: '' } });
    fireEvent.click(submit());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('C. published mentor batch 不得走 content-only', () => {
  it('published 狀態仍走 save_signal_batch 原流程', async () => {
    fixture = { role: 'mentor', status: 'published', isEditing: true };
    renderEditor(true);
    await waitFor(() => expect(topicInput().value).toBe('舊標題'));
    fireEvent.change(topicInput(), { target: { value: '改標題' } });
    fireEvent.click(submit());
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][0]).toBe('save_signal_batch');
    expect(rpc.mock.calls.some(([n]) => n === 'update_pending_mentor_journal_batch')).toBe(false);
  });
});

describe('D. 其他路徑回歸', () => {
  it('新建 mentor 週記走 save_signal_batch', async () => {
    fixture = { role: 'mentor', status: null, isEditing: false };
    renderEditor(false);
    fireEvent.change(topicInput(), { target: { value: '本週主題' } });
    const code = screen.getAllByPlaceholderText(/2330|代碼|例/)[0];
    fireEvent.change(code, { target: { value: '2330' } });
    fireEvent.change(priceInput(), { target: { value: '500' } });
    fireEvent.click(submit());
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][0]).toBe('save_signal_batch');
  });

  it('advisor 編輯走 save_signal_batch', async () => {
    fixture = { role: 'advisor', status: 'published', isEditing: true };
    renderEditor(true);
    await waitFor(() => expect(screen.getByDisplayValue('2330')).toBeInTheDocument());
    fireEvent.click(submit());
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][0]).toBe('save_signal_batch');
  });
});

describe('E. RPC 錯誤處理', () => {
  it('RPC 尚未上線時顯示可理解訊息且輸入值保留', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function' } });
    renderEditor(true);
    await waitFor(() => expect(topicInput().value).toBe('舊標題'));
    fireEvent.change(topicInput(), { target: { value: '保留的新標題' } });
    fireEvent.click(submit());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain('尚未啟用');
    expect(topicInput().value).toBe('保留的新標題');
  });

  it('not_pending 顯示已公開訊息且輸入值保留', async () => {
    rpc.mockResolvedValue({ error: { message: 'not_pending' } });
    renderEditor(true);
    await waitFor(() => expect(topicInput().value).toBe('舊標題'));
    fireEvent.change(topicInput(), { target: { value: '另一個新標題' } });
    fireEvent.click(submit());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain('已經公開');
    expect(topicInput().value).toBe('另一個新標題');
  });
});
