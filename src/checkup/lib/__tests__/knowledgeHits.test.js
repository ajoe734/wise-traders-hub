import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserted = []
let currentUser = { id: 'u1' }
vi.mock('@/integrations/supabase/client', () => {
  const rows = [{ id: 'db-1', item_id: 'k1', category: 'technical_analysis', title: 't', fact: 'f', confidence: 0.9 }]
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q,
    then: (r) => Promise.resolve({ data: rows, error: null }).then(r),
  }
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: currentUser } }),
        getSession: async () => ({ data: { session: currentUser ? { user: currentUser } : null } }),
      },
      from: (t) => t === 'checkup_knowledge_hits'
        ? { insert: async (r) => { inserted.push(...r); return { error: null } } }
        : q,
    },
  }
})

describe('knowledge hits carry stock code (knowledge-validate needs it)', () => {
  beforeEach(() => { inserted.length = 0; currentUser = { id: 'u1' } })

  it('records the dossier stock code on every hit', async () => {
    const kb = await import('../knowledgeBase.js')
    await kb.preloadKnowledgeBase?.({ force: true })
    kb.buildKnowledgeContext({ strategy: '成長股' }, '2330')
    kb.buildKnowledgeContext({ strategy: '成長股' }, '2317')
    await kb.flushKnowledgeHits({ context: 'daily_analysis' })
    expect(inserted.map((r) => r.stock_code).sort()).toEqual(['2317', '2330'])
  })

  it('skips the insert for signed-out visitors', async () => {
    const kb = await import('../knowledgeBase.js')
    currentUser = null
    kb.buildKnowledgeContext({ strategy: '成長股' }, '2330')
    const res = await kb.flushKnowledgeHits({})
    expect(res.inserted).toBe(0)
    expect(inserted).toHaveLength(0)
  })
})
