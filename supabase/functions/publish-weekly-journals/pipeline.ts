/**
 * publish-weekly-journals pipeline — 每個階段都是純函式 + PublishPort 呼叫，
 * 可用 in-memory fake port 獨立驗證，不需要真的 Supabase / LINE。
 *
 * 階段：
 *   1. resolveMarketScope   依市場（TW / US）解析老師名單
 *   2. fetchPendingSignals  撈 pending 週記
 *   3. markSignalsPublished 逐筆改 published（含 transient retry / 失敗分類 / 通知導師）
 *   4. syncTradeSignals     同步 trade_signals + user_performances
 *   5. buildJournalMessages 純函式：組 LINE flex bubbles
 *   6. pushExpertJournals   逐位老師推播（訂閱者內容 / 已取消者促購）
 *   7. runPublishPipeline   串起 2–6，回傳摘要
 */
import { detectMarket, isDerivativeMarket } from '../_shared/marketDetect.ts';
import { htmlToText, buildPromoMessage, classifyLineTargets } from '../_shared/linePushCore.ts';
import { getActionLabel } from '../_shared/signalActionLabels.ts';
import { parseUnitLockError } from '../_shared/parseUnitLockError.ts';
import {
  classifyPublishError,
  buildMentorFailureNotification,
  isTransientError,
  retryTransient,
} from './classifyPublishError.ts';
import type { EmitFn, PendingSignal, PublishPort } from './port.ts';

const US_ASSET_CLASSES = ['us_stock', 'us_futures', 'crypto'];
const noopEmit: EmitFn = () => {};

export interface PublishFailure {
  signal_id: string;
  expert_id: string;
  kind: string;
  message: string;
  attempts: number;
}

// ── 1. scope ──────────────────────────────────────────────────────────────
export async function resolveMarketScope(port: PublishPort, market: 'TW' | 'US'): Promise<string[]> {
  const all = await port.listExperts();
  return all
    .filter((e) => {
      const isUs = US_ASSET_CLASSES.includes((e.asset_class || '').toLowerCase());
      return market === 'US' ? isUs : !isUs;
    })
    .map((e) => e.id);
}

// ── 2. fetch ──────────────────────────────────────────────────────────────
export function fetchPendingSignals(port: PublishPort, expertIds: string[] | null) {
  return port.listPendingSignals(expertIds);
}

// ── 3. mark published ─────────────────────────────────────────────────────
export interface MarkPublishedResult {
  publishedIds: string[];
  publishedSignals: PendingSignal[];
  failures: PublishFailure[];
  retryStats: { totalRetries: number; transientRecovered: number };
}

export async function markSignalsPublished(
  port: PublishPort,
  signals: PendingSignal[],
  emit: EmitFn = noopEmit,
): Promise<MarkPublishedResult> {
  const expertIds = Array.from(new Set(signals.map((s) => s.expert_id)));
  const expertRows = expertIds.length ? await port.listExpertsByIds(expertIds) : [];
  const expertMap = new Map(expertRows.map((e) => [e.id, e]));

  const failures: PublishFailure[] = [];
  const publishedIds: string[] = [];
  const retryStats = { totalRetries: 0, transientRecovered: 0 };

  for (const s of signals) {
    const detected = detectMarket(s.instrument);
    const market = isDerivativeMarket(detected) ? 'US' : detected;
    let attempts = 0;
    let updateErr: unknown = null;
    try {
      const { attempts: n } = await retryTransient(
        async () => { await port.markSignalPublished(s.id, market); return true; },
        {
          maxAttempts: 3,
          baseDelayMs: 200,
          onRetry: (attempt, err) => {
            retryStats.totalRetries++;
            emit('warn', 'Transient publish error, retrying', {
              stage: 'mark_published_retry',
              signalId: s.id,
              expertId: s.expert_id,
              attempt,
              errCode: (err as any)?.code,
              errMsg: (err as any)?.message,
            });
          },
        },
      );
      attempts = n;
      if (n > 1) retryStats.transientRecovered++;
    } catch (err) {
      updateErr = err;
      attempts = 3;
    }

    if (!updateErr) { publishedIds.push(s.id); continue; }

    const info = classifyPublishError(updateErr, s.instrument);
    failures.push({
      signal_id: s.id,
      expert_id: s.expert_id,
      kind: info.kind,
      message: (updateErr as any)?.message ?? String(updateErr),
      attempts,
    });
    emit('error', `FAILED: ${(updateErr as any)?.message ?? String(updateErr)}`, {
      stage: 'mark_published_iter',
      signalId: s.id,
      expertId: s.expert_id,
      kind: info.kind,
      attempts,
      transient: isTransientError(updateErr),
    });

    const unitLock = parseUnitLockError(updateErr);
    if (unitLock) {
      try {
        await port.logUnitLockViolation({
          ...unitLock,
          expert_id: (unitLock as any).expert_id || s.expert_id,
          signal_id: s.id,
          attempted_row_id: s.id,
          caller: 'publish-weekly-journals',
        });
      } catch (auditErr) {
        emit('error', `FAILED: ${(auditErr as any)?.message ?? String(auditErr)}`, {
          stage: 'log_unit_lock_violation_failed', signalId: s.id, expertId: s.expert_id,
        });
      }
    }

    const mentorUserId = expertMap.get(s.expert_id)?.user_id;
    if (mentorUserId) {
      try {
        await port.insertNotifications([
          buildMentorFailureNotification({ mentorUserId, signalId: s.id, info }) as any,
        ]);
      } catch (nErr) {
        emit('error', `FAILED: ${(nErr as any)?.message ?? String(nErr)}`, {
          stage: 'notify_mentor_failed', signalId: s.id, expertId: s.expert_id,
        });
      }
    }
  }

  const failedIds = new Set(failures.map((f) => f.signal_id));
  return {
    publishedIds,
    publishedSignals: signals.filter((s) => !failedIds.has(s.id)),
    failures,
    retryStats,
  };
}

// ── 4. sync trade_signals ─────────────────────────────────────────────────
export async function syncTradeSignals(
  port: PublishPort,
  signals: PendingSignal[],
  emit: EmitFn = noopEmit,
): Promise<{ syncOk: number; syncFail: number }> {
  let syncOk = 0, syncFail = 0;
  for (const signal of signals) {
    try {
      // 純教學 / 觀察不影響部位
      if (signal.action === 'teaching' || signal.action === 'hold') { syncOk++; continue; }

      const expert = await port.getExpert(signal.expert_id);
      if (!expert?.user_id) continue;
      const userId = expert.user_id;

      const stockCode = signal.instrument.split(' ')[0]?.trim() || '';
      const stockName = signal.instrument.split(' ').slice(1).join(' ').trim() || null;
      const entryPrice = signal.price_hint || 0;

      if (signal.action === 'exit') {
        await port.closeOpenTradeSignal(userId, stockCode);
        await port.deleteUserPerformance(userId, stockCode);
      } else if (signal.action === 'sell' || signal.action === 'trim') {
        const stillOpen = await port.hasOpenTradeRecords(signal.expert_id, stockCode);
        if (!stillOpen) {
          await port.closeOpenTradeSignal(userId, stockCode);
          await port.deleteUserPerformance(userId, stockCode);
        }
      } else {
        const exists = await port.hasOpenTradeSignal(userId, stockCode);
        if (!exists) {
          await port.openTradeSignalWithPerformance({ userId, symbol: stockCode, name: stockName, entryPrice });
        }
      }
      syncOk++;
    } catch (innerErr) {
      syncFail++;
      emit('error', `FAILED: ${(innerErr as any)?.message ?? String(innerErr)}`, {
        stage: 'sync_trade_signals_iteration',
        signalId: signal.id,
        expertId: signal.expert_id,
        instrument: signal.instrument,
        action: signal.action,
      });
    }
  }
  return { syncOk, syncFail };
}

// ── 5. message building（純函式） ─────────────────────────────────────────
export function groupByBatch(signals: PendingSignal[]): PendingSignal[][] {
  const byBatch = new Map<string, PendingSignal[]>();
  for (const s of signals) {
    const k = s.batch_id || `__solo_${s.id}`;
    const arr = byBatch.get(k) || [];
    arr.push(s);
    byBatch.set(k, arr);
  }
  return Array.from(byBatch.values());
}

export function buildJournalBubble(expertName: string, group: PendingSignal[]): any {
  const first = group[0];
  const teachingTopic = htmlToText(first.teaching_topic || '');
  const overallSummary = htmlToText(first.overall_summary || '');
  const learningPoints = htmlToText(first.learning_points || '');

  const bodyContents: any[] = [];
  if (teachingTopic) {
    bodyContents.push({ type: 'text', text: `📚 ${teachingTopic}`, weight: 'bold', size: 'lg', color: '#333333', wrap: true });
  }
  bodyContents.push({
    type: 'text',
    text: `本週共 ${group.length} 筆 操作紀錄`,
    weight: teachingTopic ? 'regular' : 'bold',
    size: teachingTopic ? 'sm' : 'lg',
    color: '#333333',
    margin: teachingTopic ? 'md' : undefined,
  });
  if (overallSummary) {
    bodyContents.push({ type: 'text', text: overallSummary, size: 'sm', color: '#666666', margin: 'md', wrap: true });
  }
  bodyContents.push({ type: 'separator', margin: 'lg' });

  for (const s of group) {
    const label = getActionLabel(s.action);
    const isBullish = ['buy', 'add'].includes(s.action);
    const color = isBullish ? '#DC3545' : '#00B900'; // 台股慣例：紅漲綠跌
    bodyContents.push({ type: 'text', text: `${label} ${s.instrument}`, size: 'md', color, margin: 'lg', weight: 'bold' });
    const rs = htmlToText(s.reason_summary);
    const rd = htmlToText(s.reason_detail);
    const rn = htmlToText(s.risk_notes);
    if (rs) bodyContents.push({ type: 'text', text: `❓ 為什麼這樣操作？${rs}`, size: 'sm', color: '#444444', margin: 'sm', wrap: true });
    if (rd) bodyContents.push({ type: 'text', text: `◉ 部位控管想法：${rd}`, size: 'xs', color: '#666666', margin: 'sm', wrap: true });
    if (rn) bodyContents.push({ type: 'text', text: `⚠️ 風險提醒：${rn}`, size: 'sm', color: '#444444', margin: 'sm', wrap: true });
    bodyContents.push({ type: 'separator', margin: 'md' });
  }
  if (learningPoints) {
    bodyContents.push({ type: 'text', text: `🎯 教學重點：${learningPoints}`, size: 'sm', color: '#333333', margin: 'md', wrap: true });
  }

  const copyLines: string[] = [`${expertName} 本週週記`, ''];
  if (teachingTopic) copyLines.push(`📚 教學主題：${teachingTopic}`);
  if (overallSummary) copyLines.push(`📝 整體摘要：${overallSummary}`);
  copyLines.push(`本週共 ${group.length} 筆操作紀錄`, '');
  for (const s of group) {
    copyLines.push(`【${getActionLabel(s.action)} ${s.instrument}】`);
    const rs = htmlToText(s.reason_summary);
    const rd = htmlToText(s.reason_detail);
    const rn = htmlToText(s.risk_notes);
    if (rs) copyLines.push(`❓ ${rs}`);
    if (rd) copyLines.push(`◉ ${rd}`);
    if (rn) copyLines.push(`⚠️ ${rn}`);
    copyLines.push('');
  }
  if (learningPoints) copyLines.push(`🎯 教學重點：${learningPoints}`);

  return {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', contents: bodyContents },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'lg',
      contents: [{
        type: 'button',
        action: { type: 'clipboard', label: '📋 一鍵複製', clipboardText: copyLines.join('\n') },
        style: 'secondary', height: 'sm', color: '#F0F0F0',
      }],
    },
  };
}

/** LINE 限制：一個 carousel 最多 10 bubbles → 超過拆成多則訊息。 */
export function buildJournalMessages(expertName: string, signals: PendingSignal[]): any[] {
  const bubbles = groupByBatch(signals).map((g) => buildJournalBubble(expertName, g));
  const altText = `📖 ${expertName} 本週週記已發布（${signals.length} 筆操作）`;
  const messages: any[] = [];
  for (let i = 0; i < bubbles.length; i += 10) {
    const slice = bubbles.slice(i, i + 10);
    messages.push({
      type: 'flex',
      altText,
      contents: slice.length === 1 ? slice[0] : { type: 'carousel', contents: slice },
    });
  }
  return messages;
}

// ── 6. LINE push ──────────────────────────────────────────────────────────

/**
 * 推播冪等鍵：同一位老師 + 同一種訊息 + 同一組訊號 = 同一把鍵。
 * 只要內容不變，runner 重跑或 90s abort 後重跑都會算出相同鍵，
 * 已寫入收據的收件人就不會再收到第二次。
 */
export function computePushDedupeKey(
  expertId: string,
  kind: string,
  signals: Pick<PendingSignal, 'id'>[],
): string {
  const ids = signals.map((s) => s.id).sort();
  // FNV-1a：同步、無依賴、對「相同 id 集合」穩定
  let h = 0x811c9dc5;
  for (const ch of ids.join(',')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${expertId}:${kind}:${ids.length}:${h.toString(16)}`;
}

/**
 * 佔位 → 送出 → 失敗釋放。
 * 佔位先寫入收據，因此送出後即使 runner 被 abort、收據也已存在，重跑不會重送；
 * 送出失敗才釋放佔位，讓下一次重跑補送。
 */
async function pushWithIdempotency(
  port: PublishPort,
  args: {
    dedupeKey: string; kind: string; expertId: string; token: string;
    recipients: string[]; messages: unknown[]; label: string;
  },
  emit: EmitFn,
): Promise<number> {
  const { dedupeKey, kind, expertId, token, recipients, messages, label } = args;
  if (recipients.length === 0 || messages.length === 0) return 0;
  const stage = 'line_push';
  let pushed = 0;

  for (let i = 0; i < recipients.length; i += 500) {
    const batch = recipients.slice(i, i + 500);
    const claimed = await port.claimPushRecipients({ dedupeKey, kind, expertId, recipients: batch });
    const skipped = batch.length - claimed.length;
    if (skipped > 0) {
      emit('info', `LINE push skipped (already sent, ${label})`, { stage, expertId, dedupeKey, skipped });
    }
    if (claimed.length === 0) continue;

    let res;
    try {
      res = await port.sendLineMulticast(token, claimed, messages);
    } catch (err) {
      await port.releasePushClaims(dedupeKey, claimed);
      throw err;
    }
    if (res.ok) {
      pushed += claimed.length;
      emit('info', `LINE push ok (${label})`, { stage, expertId, count: claimed.length, dedupeKey });
    } else {
      await port.releasePushClaims(dedupeKey, claimed);
      emit('error', `LINE push failed (${label})`, { stage, expertId, status: res.status, body: res.body, dedupeKey });
    }
  }
  return pushed;
}

export async function pushExpertJournals(
  port: PublishPort,
  args: { expertId: string; signals: PendingSignal[]; force: boolean },
  emit: EmitFn = noopEmit,
): Promise<{ pushed: number }> {
  const { expertId, signals, force } = args;
  const stage = 'line_push';
  let pushed = 0;

  const channel = await port.getLineChannel(expertId);
  if (!channel?.is_active || !channel?.channel_access_token) {
    emit('warn', 'No active LINE channel', { stage, expertId });
    return { pushed: 0 };
  }
  const token = channel.channel_access_token;

  const expert = await port.getExpert(expertId);
  const bindings = await port.listActiveBindings(expertId);
  if (bindings.length === 0) {
    emit('warn', 'No LINE bindings', { stage, expertId });
    return { pushed: 0 };
  }

  const activeSubs = await port.listActiveSubscriptions(bindings.map((b) => b.user_id));
  const expertPlanIds = new Set(await port.listExpertPlanIds(expertId));
  const { subscribedTargets, canceledTargets } = classifyLineTargets(
    bindings as any, activeSubs as any, expertPlanIds,
  );
  // 由 classifyLineTargets 的結果反查 user_id（不是另一套分流邏輯）
  const notifyUserIds = new Set(
    bindings.filter((b) => subscribedTargets.includes(b.line_user_id)).map((b) => b.user_id),
  );


  const expertName = expert?.name || '導師';

  // 提前發布：對訂閱者發站內通知（同樣走收據，避免重跑重複通知）
  if (force && notifyUserIds.size > 0) {
    const slug = expert?.slug || null;
    const link = slug ? `/app/expert/${slug}` : '/account/notifications';
    const notifyKey = computePushDedupeKey(expertId, 'notify_early', signals);
    try {
      const claimed = await port.claimPushRecipients({
        dedupeKey: notifyKey, kind: 'notify_early', expertId,
        recipients: Array.from(notifyUserIds),
      });
      if (claimed.length > 0) {
        const notifRows = claimed.map((uid) => ({
          user_id: uid,
          title: `${expertName} 本週週記已提前開放`,
          body: `${expertName} 老師提前公開本週 ${signals.length} 筆操作紀錄，點此立即查看。`,
          type: 'info',
          link,
        }));
        try {
          await port.insertNotifications(notifRows);
          emit('info', 'Early-publish notifications sent', { stage: 'notify_subscribers_early', expertId, count: notifRows.length });
        } catch (nErr) {
          await port.releasePushClaims(notifyKey, claimed);
          throw nErr;
        }
      } else {
        emit('info', 'Early-publish notifications skipped (already sent)', {
          stage: 'notify_subscribers_early', expertId,
        });
      }
    } catch (nErr) {
      emit('warn', 'insert early-publish notifications failed', {
        stage: 'notify_subscribers_early', expertId, count: notifyUserIds.size,
        err: (nErr as any)?.message ?? String(nErr),
      });
    }
  }

  const messages = buildJournalMessages(expertName, signals);

  pushed += await pushWithIdempotency(port, {
    dedupeKey: computePushDedupeKey(expertId, 'journal', signals),
    kind: 'journal', expertId, token,
    recipients: subscribedTargets,
    messages: messages.slice(0, 5), // LINE 一次最多 5 則
    label: 'subscribed',
  }, emit);

  if (canceledTargets.length > 0) {
    const perfData = await port.calcExpertPerformance(expertId);
    const promoMsg = buildPromoMessage(expertName, perfData as any, signals.length);
    pushed += await pushWithIdempotency(port, {
      dedupeKey: computePushDedupeKey(expertId, 'promo', signals),
      kind: 'promo', expertId, token,
      recipients: canceledTargets,
      messages: [promoMsg],
      label: 'canceled',
    }, emit);
  }

  return { pushed };
}


// ── 7. orchestrator ───────────────────────────────────────────────────────
export interface PipelineResult {
  published: number;
  failed: number;
  failures: PublishFailure[];
  pushed: number;
  pushFail: number;
  syncOk: number;
  syncFail: number;
  retryStats: { totalRetries: number; transientRecovered: number };
}

export async function runPublishPipeline(
  port: PublishPort,
  args: { filterExpertIds: string[] | null; force?: boolean },
  emit: EmitFn = noopEmit,
): Promise<PipelineResult> {
  const empty: PipelineResult = {
    published: 0, failed: 0, failures: [], pushed: 0, pushFail: 0,
    syncOk: 0, syncFail: 0, retryStats: { totalRetries: 0, transientRecovered: 0 },
  };

  const pending = await fetchPendingSignals(port, args.filterExpertIds);
  if (!pending || pending.length === 0) {
    emit('info', 'No pending signals to publish', { stage: 'fetch_pending_signals' });
    return empty;
  }
  emit('info', `Found ${pending.length} pending signals`, { stage: 'fetch_pending_signals' });

  const marked = await markSignalsPublished(port, pending, emit);
  emit('info',
    `Published ${marked.publishedIds.length}/${pending.length} signals (failed=${marked.failures.length}, retries=${marked.retryStats.totalRetries}, recovered=${marked.retryStats.transientRecovered})`,
    {
      stage: 'mark_published',
      failedByKind: marked.failures.reduce((acc: Record<string, number>, f) => {
        acc[f.kind] = (acc[f.kind] || 0) + 1; return acc;
      }, {}),
      retryStats: marked.retryStats,
    },
  );

  const { syncOk, syncFail } = await syncTradeSignals(port, marked.publishedSignals, emit);
  emit('info', `Trade signals synced (ok=${syncOk}, fail=${syncFail})`, { stage: 'sync_trade_signals' });

  const byExpert = new Map<string, PendingSignal[]>();
  for (const s of marked.publishedSignals) {
    const list = byExpert.get(s.expert_id) || [];
    list.push(s);
    byExpert.set(s.expert_id, list);
  }

  let pushed = 0, pushFail = 0;
  for (const [expertId, signals] of byExpert) {
    try {
      const r = await pushExpertJournals(port, { expertId, signals, force: args.force === true }, emit);
      pushed += r.pushed;
    } catch (expertErr) {
      pushFail++;
      emit('error', `FAILED: ${(expertErr as any)?.message ?? String(expertErr)}`, {
        stage: 'line_push_iteration', expertId,
      });
    }
  }

  return {
    published: marked.publishedIds.length,
    failed: marked.failures.length,
    failures: marked.failures,
    pushed,
    pushFail,
    syncOk,
    syncFail,
    retryStats: marked.retryStats,
  };
}
