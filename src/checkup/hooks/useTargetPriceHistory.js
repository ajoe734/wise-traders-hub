import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'

/**
 * Loads target_price_history for a single stock code (most recent first).
 * Returns { rows, loading, reload }.
 */
export function useTargetPriceHistory(code, { limit = 30, enabled = true } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!code || !enabled) { setRows([]); return }
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setRows([]); return }
      const { data, error } = await supabase
        .from('target_price_history')
        .select('id, firm, target, prev_target, report_date, change_type, source, batch_id, created_at, detail')
        .eq('user_id', user.id)
        .eq('code', code)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      setRows(data || [])
    } catch (e) {
      console.error('useTargetPriceHistory load failed:', e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [code, limit, enabled])

  useEffect(() => { reload() }, [reload])

  return { rows, loading, reload }
}

/**
 * Inserts a batch of target price observations and computes change_type vs prior.
 * `entries`: [{ firm, target, date }]
 * `source`: 'refresh-reports' | 'weekly-cron' | 'manual' | ...
 */
export async function recordTargetPriceBatch(code, entries, source = 'refresh-reports') {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !code || !Array.isArray(entries) || entries.length === 0) return { inserted: 0, batchId: null }

    // Get latest target per (code, firm) to compute prev_target
    const { data: latest } = await supabase
      .from('target_price_history')
      .select('firm, target, created_at')
      .eq('user_id', user.id)
      .eq('code', code)
      .order('created_at', { ascending: false })
      .limit(200)

    const latestByFirm = new Map()
    for (const row of latest || []) {
      if (!latestByFirm.has(row.firm)) latestByFirm.set(row.firm, Number(row.target))
    }

    const batchId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null
    const rows = []
    for (const e of entries) {
      const target = Number(e?.target)
      if (!Number.isFinite(target) || target <= 0) continue
      const firm = String(e?.firm || '').trim()
      const prev = latestByFirm.get(firm)
      let changeType = 'new'
      if (Number.isFinite(prev)) {
        if (prev === target) continue // skip duplicates
        changeType = 'updated'
      }
      rows.push({
        user_id: user.id,
        code,
        firm,
        target,
        prev_target: Number.isFinite(prev) ? prev : null,
        report_date: e?.date ? String(e.date) : null,
        change_type: changeType,
        source,
        batch_id: batchId,
      })
    }
    if (rows.length === 0) return { inserted: 0, batchId }
    const { error } = await supabase.from('target_price_history').insert(rows)
    if (error) throw error
    return { inserted: rows.length, batchId }
  } catch (e) {
    console.error('recordTargetPriceBatch failed:', e)
    return { inserted: 0, batchId: null, error: e?.message }
  }
}
