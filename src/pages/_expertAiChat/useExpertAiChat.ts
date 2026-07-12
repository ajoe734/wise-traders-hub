import { useEffect, useRef, useState, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { extractErrorIdFromMessage } from './errorIdParser';

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

  const authTokenRef = useRef<string | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      authTokenRef.current = data.session?.access_token || null;
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authTokenRef.current = session?.access_token || null;
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const [canRetry, setCanRetry] = useState(false);
  const [errorId, setErrorId] = useState<string | null>(null);
  const autoRetriedRef = useRef(false);
  const lastErrorQuotaRef = useRef(false);
  const lastErrorIdRef = useRef<string | null>(null);

  // 追蹤鏈：每次 fetch 前端生一個 requestId 送 x-request-id；
  // 回應時 endpoint 會 echo x-request-id 並蓋章 x-correlation-id。
  // 顯示在 UI 診斷區塊、供回報排查。
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);

  // 串流終止資訊
  const [terminatedBy, setTerminatedBy] = useState<'finish' | 'abort' | 'timeout' | 'error' | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const timeoutHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortedRef = useRef(false);
  const STREAM_TIMEOUT_MS = 120_000;

  const clearWatchdog = () => {
    if (timeoutHandleRef.current) {
      clearTimeout(timeoutHandleRef.current);
      timeoutHandleRef.current = null;
    }
  };

  const genRequestId = () => {
    try { return crypto.randomUUID(); } catch {
      return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
  };

  const transport = new DefaultChatTransport({
    api: `${SUPABASE_URL}/functions/v1/expert-ai-chat`,
    headers: () => {
      const rid = pendingRequestIdRef.current ?? genRequestId();
      pendingRequestIdRef.current = rid;
      return {
        Authorization: `Bearer ${authTokenRef.current || SUPABASE_PUBLISHABLE_KEY}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'x-request-id': rid,
      };
    },
    body: () => ({ expert_id: expertId }),
    // 攔截非 2xx 回應 → 解析錯誤 body、更新配額 / errorId
    fetch: async (input, init) => {
      // useChat/DefaultChatTransport 可能保留初次 render 的 transport；若當時 session 尚未
      // hydrate，headers 會把公開 key 當 Authorization 送出，後端就會判定 unauthorized。
      // 因此每次真正 fetch 前重新讀一次目前 session，並覆寫 Authorization。
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || authTokenRef.current;
      if (token) authTokenRef.current = token;
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`);
      headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
      const resp = await fetch(input as any, { ...init, headers });
      lastErrorQuotaRef.current = false;
      // 追蹤鏈 header：不論成功或失敗都讀（CORS Expose-Headers 已放行）
      const cid = resp.headers.get('x-correlation-id');
      const rid = resp.headers.get('x-request-id') ?? pendingRequestIdRef.current;
      if (cid) setCorrelationId(cid);
      if (rid) setRequestId(rid);
      pendingRequestIdRef.current = null;
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
      clearWatchdog();
      if (startedAtRef.current != null) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
      setTerminatedBy((prev) => prev ?? 'finish');
      setQuotaError(null);
      autoRetriedRef.current = false;
      setCanRetry(false);
      setErrorId(null);
      lastErrorIdRef.current = null;
      refreshQuota();
    },
    onError: (err) => {
      clearWatchdog();
      if (startedAtRef.current != null) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
      setTerminatedBy('error');
      // 從 header/body 或 error.message 中撈 errorId（stream 錯誤走 message）
      const eid = lastErrorIdRef.current || extractErrorIdFromMessage(err?.message);
      setErrorId(eid);
      if (eid && !lastErrorQuotaRef.current) {
        toast.error(`AI 對話發生錯誤 (errorId: ${eid})`, {
          description: '請點擊「重試」或把 errorId 回報給客服追查。',
        });
      }
      // 配額用完不自動重試；否則自動重試一次，第二次仍失敗才顯示手動重試按鈕
      // 配額用完不自動重試；其他錯誤也不自動重試（避免連續 fetch 失敗造成「無限錯誤」感），
      // 一律顯示手動重試按鈕由使用者決定。
      if (lastErrorQuotaRef.current) {
        setCanRetry(false);
        return;
      }
      setCanRetry(true);
    },
  });

  // 丟掉最後一則（可能仍在串流的）assistant 訊息，避免殘留半句話
  const dropTrailingAssistant = useCallback(() => {
    chat.setMessages((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') return prev.slice(0, -1);
      return prev;
    });
  }, [chat]);

  const cancelStream = useCallback(() => {
    if (abortedRef.current) return;
    abortedRef.current = true;
    clearWatchdog();
    if (startedAtRef.current != null) {
      setElapsedMs(Date.now() - startedAtRef.current);
    }
    setTerminatedBy('abort');
    // 1) 中止底層 fetch/stream
    try { chat.stop?.(); } catch { /* noop */ }
    // 2) 立刻丟掉尾端 assistant 訊息，之後 useChat 的 setMessages guard 會擋住殘留 chunk
    dropTrailingAssistant();
    // 3) 再排一次 microtask，確保 abort 當下已在 in-flight 的 chunk flush 完也會被清掉
    queueMicrotask(() => dropTrailingAssistant());
    autoRetriedRef.current = true;
    setCanRetry(false);
  }, [chat, dropTrailingAssistant]);

  // Abort 之後若還有殘留 chunk 觸發 setMessages（同步微批次），持續把尾端 assistant 清掉，
  // 直到 send/retry 重置 abortedRef 為止。
  useEffect(() => {
    if (!abortedRef.current) return;
    const last = chat.messages[chat.messages.length - 1];
    if (last?.role === 'assistant') dropTrailingAssistant();
  }, [chat.messages, dropTrailingAssistant]);

  const retry = useCallback(() => {
    if (lastErrorQuotaRef.current) return;
    setCanRetry(false);
    setErrorId(null);
    lastErrorIdRef.current = null;
    autoRetriedRef.current = true;
    abortedRef.current = false;
    setTerminatedBy(null);
    setElapsedMs(null);
    startedAtRef.current = Date.now();
    clearWatchdog();
    timeoutHandleRef.current = setTimeout(() => {
      setTerminatedBy('timeout');
      try { chat.stop?.(); } catch { /* noop */ }
      dropTrailingAssistant();
    }, STREAM_TIMEOUT_MS);
    try { chat.regenerate(); } catch { setCanRetry(true); }
  }, [chat, dropTrailingAssistant]);

  const sendMessageWrapped: typeof chat.sendMessage = (...args) => {
    autoRetriedRef.current = false;
    abortedRef.current = false;
    setCanRetry(false);
    setErrorId(null);
    lastErrorIdRef.current = null;
    setTerminatedBy(null);
    setElapsedMs(null);
    startedAtRef.current = Date.now();
    clearWatchdog();
    timeoutHandleRef.current = setTimeout(() => {
      setTerminatedBy('timeout');
      try { chat.stop?.(); } catch { /* noop */ }
      dropTrailingAssistant();
    }, STREAM_TIMEOUT_MS);
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
    terminatedBy,
    elapsedMs,
    cancelStream,
    correlationId,
    requestId,
  };
}
