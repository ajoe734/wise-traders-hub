/**
 * 正式環境 adapter：supabase client + 瀏覽器 fetch。
 */
import { supabase } from '@/integrations/supabase/client';
import {
  CheckupGatewayError,
  type CheckupGateway,
  type RealtimeSpec,
} from './types';

async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err: any) {
    throw new CheckupGatewayError(err?.message || 'Network request failed', { url });
  }
  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    throw new CheckupGatewayError(body || `Request failed with status ${res.status}`, {
      status: res.status,
      url,
      body,
    });
  }
  return res;
}

export function createSupabaseGateway(): CheckupGateway {
  return {
    http: {
      async json<T>(url: string, init?: RequestInit): Promise<T> {
        const res = await request(url, init);
        try {
          return (await res.json()) as T;
        } catch (err: any) {
          throw new CheckupGatewayError(err?.message || 'Invalid JSON response', {
            status: res.status,
            url,
          });
        }
      },
      async tryJson<T>(url: string, init?: RequestInit): Promise<T | null> {
        try {
          const res = await request(url, init);
          return (await res.json()) as T;
        } catch {
          return null;
        }
      },
      async text(url: string, init?: RequestInit): Promise<string> {
        const res = await request(url, init);
        return res.text();
      },
      async blob(url: string, init?: RequestInit): Promise<Blob> {
        const res = await request(url, init);
        return res.blob();
      },
    },

    db: {
      from: (table: string) => (supabase as any).from(table),
    },

    auth: {
      async getUserId() {
        try {
          const { data } = await supabase.auth.getUser();
          return data?.user?.id ?? null;
        } catch {
          return null;
        }
      },
      onAuthStateChange(handler) {
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          handler(session?.user?.id ?? null);
        });
        return () => data?.subscription?.unsubscribe?.();
      },
      async getAccessToken() {
        try {
          const { data } = await supabase.auth.getSession();
          return data?.session?.access_token ?? null;
        } catch {
          return null;
        }
      },
    },

    realtime: {
      subscribe(spec: RealtimeSpec, handler) {
        const channel = (supabase as any)
          .channel(spec.name)
          .on(
            'postgres_changes',
            {
              event: spec.event ?? '*',
              schema: spec.schema ?? 'public',
              table: spec.table,
              ...(spec.filter ? { filter: spec.filter } : {}),
            },
            handler,
          )
          .subscribe();
        return () => {
          try {
            (supabase as any).removeChannel(channel);
          } catch {
            /* ignore */
          }
        };
      },
    },

    async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
      const { data, error } = await (supabase as any).rpc(fn, args ?? {});
      if (error) {
        throw new CheckupGatewayError(error.message || `RPC ${fn} failed`, {
          status: (error as any)?.status ?? 0,
          url: fn,
        });
      }
      return data as T;
    },

    async invoke<T>(name: string, body?: unknown): Promise<T> {
      const { data, error } = await supabase.functions.invoke(name, body === undefined ? {} : { body });
      if (error) {
        throw new CheckupGatewayError(error.message || `Edge function ${name} failed`, {
          status: (error as any)?.status ?? 0,
          url: name,
        });
      }
      return data as T;
    },

    functionsUrl() {
      return (
        (supabase as any).functionsUrl ||
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
      );
    },
  };
}
