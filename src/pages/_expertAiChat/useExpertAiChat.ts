import { useEffect, useRef, useState, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface HistoryMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface ExpertAiQuota {
  limit: number;
  used: number;
  remaining: number;
  resets_at: string;
  unlimited?: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function historyToUIMessages(rows: HistoryMsg[]): UIMessage[] {
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      id: r.id,
      role: r.role,
      parts: [{ type: 'text' as const, text: r.content }],
    })) as UIMessage[];
}

export function useExpertAiChat(expertId: string | null | undefined) {
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quota, setQuota] = useState<ExpertAiQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const refreshQuota = useCallback(async () => {
    if (!expertId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const url = `${SUPABASE_URL}/functions/v1/expert-ai-conversation?expert_id=${expertId}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
      });
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.quota) setQuota(json.quota);
    } catch { /* noop */ }
  }, [expertId]);

  useEffect(() => {
    if (!expertId) return;
    if (loadedFor.current === expertId) return;
    loadedFor.current = expertId;
    setLoadingHistory(true);
    setLoadError(null);

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const url = `${SUPABASE_URL}/functions/v1/expert-ai-conversation?expert_id=${expertId}`;
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`,
            apikey: SUPABASE_PUBLISHABLE_KEY,
          },
        });
        if (!resp.ok) throw new Error(`載入失敗 (${resp.status})`);
        const json = await resp.json();
        setHistory(historyToUIMessages(json.messages || []));
        if (json.quota) setQuota(json.quota);
      } catch (e: any) {
        setLoadError(e?.message || '載入對話失敗');
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, [expertId]);

  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthToken(data.session?.access_token || null);
    });
  }, []);

  const [canRetry, setCanRetry] = useState(false);
  const [errorId, setErrorId] = useState<string | null>(null);
  const autoRetriedRef = useRef(false);
  const lastErrorQuotaRef = useRef(false);
  const lastErrorIdRef = useRef<string | null>(null);

  const extractErrorIdFromMessage = (msg?: string): string | null => {
    if (!msg) return null;
    const m = msg.match(/errorId[:：]\s*(err_[a-z0-9_]+)/i);
    return m ? m[1] : null;
  };

  const transport = new DefaultChatTransport({
    api: `${SUPABASE_URL}/functions/v1/expert-ai-chat`,
    headers: () => ({
      Authorization: `Bearer ${authToken || SUPABASE_PUBLISHABLE_KEY}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    }),
    body: () => ({ expert_id: expertId }),
    // 攔截非 2xx 回應 → 解析錯誤 body、更新配額 / errorId
    fetch: async (input, init) => {
      const resp = await fetch(input as any, init);
      lastErrorQuotaRef.current = false;
      if (!resp.ok) {
        // 優先讀 header（stream 情境仍可拿到）
        const headerErrId = resp.headers.get('x-error-id');
        if (headerErrId) lastErrorIdRef.current = headerErrId;
        try {
          const cloned = resp.clone();
          const body = await cloned.json();
          if (body?.errorId) lastErrorIdRef.current = body.errorId;
          if (body?.code === 'AI_CHAT_QUOTA_EXCEEDED') {
            lastErrorQuotaRef.current = true;
            if (body.quota) setQuota(body.quota);
            setQuotaError(body.message || '今日 AI 對話次數已達上限');
          }
        } catch { /* ignore */ }
      } else {
        lastErrorIdRef.current = null;
      }
      return resp;
    },
  });

  const chat = useChat({
    id: expertId ? `expert-ai-${expertId}` : undefined,
    messages: history,
    transport,
    onFinish: () => {
      setQuotaError(null);
      autoRetriedRef.current = false;
      setCanRetry(false);
      setErrorId(null);
      lastErrorIdRef.current = null;
      refreshQuota();
    },
    onError: (err) => {
      // 從 header/body 或 error.message 中撈 errorId（stream 錯誤走 message）
      const eid = lastErrorIdRef.current || extractErrorIdFromMessage(err?.message);
      setErrorId(eid);
      if (eid && !lastErrorQuotaRef.current) {
        toast.error(`AI 對話發生錯誤 (errorId: ${eid})`, {
          description: '請點擊「重試」或把 errorId 回報給客服追查。',
        });
      }
      // 配額用完不自動重試；否則自動重試一次，第二次仍失敗才顯示手動重試按鈕
      if (lastErrorQuotaRef.current) {
        setCanRetry(false);
        return;
      }
      if (!autoRetriedRef.current) {
        autoRetriedRef.current = true;
        setTimeout(() => {
          try { chat.regenerate(); } catch { setCanRetry(true); }
        }, 600);
      } else {
        setCanRetry(true);
      }
    },
  });

  const retry = useCallback(() => {
    if (lastErrorQuotaRef.current) return;
    setCanRetry(false);
    setErrorId(null);
    lastErrorIdRef.current = null;
    autoRetriedRef.current = true;
    try { chat.regenerate(); } catch { setCanRetry(true); }
  }, [chat]);

  const sendMessageWrapped: typeof chat.sendMessage = (...args) => {
    autoRetriedRef.current = false;
    setCanRetry(false);
    setErrorId(null);
    lastErrorIdRef.current = null;
    return chat.sendMessage(...args);
  };

  const clearConversation = async () => {
    if (!expertId) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    await fetch(`${SUPABASE_URL}/functions/v1/expert-ai-conversation?expert_id=${expertId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    });
    setHistory([]);
    chat.setMessages([]);
    setQuotaError(null);
    autoRetriedRef.current = false;
    setCanRetry(false);
    refreshQuota();
  };

  return {
    ...chat,
    sendMessage: sendMessageWrapped,
    loadingHistory,
    loadError,
    clearConversation,
    quota,
    quotaError,
    refreshQuota,
    canRetry,
    retry,
    errorId,
  };
}
