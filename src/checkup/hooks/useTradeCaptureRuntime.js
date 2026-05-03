import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MEMO_Q, PARSE_PROMPT } from '../constants.js'
import {
  applyParsedTradesToHoldings,
  buildTradeLogEntries,
  getTradeBatchMode,
  normalizeTradeParseResult,
} from '../lib/tradeParseUtils.js'
import { parseJsonObject } from '../lib/aiJsonRepair.js'
import { partitionUploadFiles, summarizeRejections } from '../lib/tradeUploadGuards.js'
import { preprocessForUpload } from '../lib/imageProcess.js'
import { callEdge } from '../lib/edgeInvoke.js'
import { useCheckupMode } from '../contexts/CheckupModeContext.jsx'
// Phase 3A.4 Step 1: store 直取 setter
import { useHoldingsStore } from '../stores/holdingsStore.js'

function createEmptyTradeEditorState(createDefaultFundamentalDraft) {
  return {
    uploads: [],
    activeUploadId: null,
    tpCode: '',
    tpFirm: '',
    tpVal: '',
    fundamentalDraft: createDefaultFundamentalDraft(),
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`讀取檔案失敗：${file?.name || 'unknown'}`))
    reader.onload = (event) => resolve(String(event.target?.result || ''))
    reader.readAsDataURL(file)
  })
}

function revokeUploadPreview(upload) {
  if (upload?.img) {
    URL.revokeObjectURL(upload.img)
  }
}

export function useTradeCaptureRuntime({
  holdings = [],
  tradeLog = [],
  marketQuotes = null,
  upsertTargetReport = () => false,
  upsertFundamentalsEntry = () => false,
  applyTradeEntryToHoldings = (rows) => rows,
  createDefaultFundamentalDraft = () => ({}),
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
  flashSaved = () => {},
  afterSubmit = () => {},
  isDemo = false,
}) {
  const setHoldings = useHoldingsStore((s) => s.setHoldings)
  const setTradeLog = useHoldingsStore((s) => s.setTradeLog)
  let modeCtx = null
  try { modeCtx = useCheckupMode() } catch { /* test env / no provider */ }
  const { hasQuota, applyQuotaFromResponse } = modeCtx || {}
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0 })
  const [tradeEditorState, setTradeEditorState] = useState(() =>
    createEmptyTradeEditorState(createDefaultFundamentalDraft)
  )
  const uploadIdRef = useRef(0)
  const uploadsRef = useRef([])

  useEffect(() => {
    uploadsRef.current = tradeEditorState.uploads
  }, [tradeEditorState.uploads])

  useEffect(
    () => () => {
      uploadsRef.current.forEach(revokeUploadPreview)
    },
    []
  )

  const updateActiveUpload = useCallback((updater) => {
    setTradeEditorState((prev) => {
      const uploads = prev.uploads.map((upload) => {
        if (upload.id !== prev.activeUploadId) return upload
        return typeof updater === 'function' ? updater(upload) : { ...upload, ...updater }
      })
      return { ...prev, uploads }
    })
  }, [])

  const enqueueFiles = useCallback(
    async (incomingFiles) => {
      if (isDemo) {
        flashSaved('🔒 訪客模式不能上傳成交，請先用 Line 登入', 4000)
        return
      }
      if (hasQuota === false) {
        flashSaved('🔒 本期 AI 解析額度已用完，請升級方案後再試', 4500)
        return
      }

      const { accepted, rejected, overflow } = partitionUploadFiles(incomingFiles, {
        existingCount: uploadsRef.current.length,
      })

      // HEIC 轉 JPEG + 壓縮（長邊 1600 / JPEG 0.85），失敗的退回 rejected
      let heicFailed = 0
      const processed = []
      for (const file of accepted) {
        try {
          processed.push(await preprocessForUpload(file))
        } catch (err) {
          if (err?.code === 'HEIC_CONVERT_FAILED') heicFailed += 1
          else rejected.push({ file, reason: 'not-image' })
        }
      }

      const rejectionMsg = summarizeRejections({ rejected, overflow, heicFailed })
      if (rejectionMsg) flashSaved(rejectionMsg, 4500)
      if (!processed.length) return

      try {
        const nextUploads = await Promise.all(
          processed.map(async (file) => {
            const dataUrl = await readFileAsDataUrl(file)
            const objectUrl = URL.createObjectURL(file)
            uploadIdRef.current += 1
            return {
              id: `upload-${Date.now()}-${uploadIdRef.current}`,
              name: file.name || `截圖-${uploadIdRef.current}`,
              img: objectUrl,
              b64: String(dataUrl.split(',')[1] || ''),
              mediaType: file.type || 'image/jpeg',
              parsed: null,
              parseErr: '',
              tradeDate: toSlashDate(),
              memoStep: 0,
              memoAns: [],
              memoIn: '',
            }
          })
        )

        setTradeEditorState((prev) => ({
          ...prev,
          uploads: [...prev.uploads, ...nextUploads],
          activeUploadId: prev.activeUploadId || nextUploads[0]?.id || null,
        }))
      } catch (error) {
        flashSaved(`❌ 讀取截圖失敗：${error.message || '請重新選擇圖片'}`, 4000)
      }
    },
    [flashSaved, toSlashDate, isDemo, hasQuota]
  )

  const processFile = useCallback(
    (file) => {
      void enqueueFiles(file ? [file] : [])
    },
    [enqueueFiles]
  )

  const processFiles = useCallback(
    (files) => {
      void enqueueFiles(files)
    },
    [enqueueFiles]
  )

  const activeUpload = useMemo(
    () =>
      tradeEditorState.uploads.find((upload) => upload.id === tradeEditorState.activeUploadId) ||
      null,
    [tradeEditorState.activeUploadId, tradeEditorState.uploads]
  )

  const selectUpload = useCallback((uploadId) => {
    setTradeEditorState((prev) =>
      prev.uploads.some((upload) => upload.id === uploadId)
        ? { ...prev, activeUploadId: uploadId }
        : prev
    )
  }, [])

  const removeUpload = useCallback((uploadId) => {
    setTradeEditorState((prev) => {
      const upload = prev.uploads.find((item) => item.id === uploadId)
      if (upload) revokeUploadPreview(upload)

      const uploads = prev.uploads.filter((item) => item.id !== uploadId)
      const nextActive =
        prev.activeUploadId === uploadId ? uploads[0]?.id || null : prev.activeUploadId

      return {
        ...prev,
        uploads,
        activeUploadId: nextActive,
      }
    })
  }, [])

  const clearUploads = useCallback(() => {
    setTradeEditorState((prev) => {
      prev.uploads.forEach(revokeUploadPreview)
      return {
        ...prev,
        uploads: [],
        activeUploadId: null,
      }
    })
  }, [])

  const resetTradeCapture = useCallback(() => {
    setTradeEditorState((prev) => {
      prev.uploads.forEach(revokeUploadPreview)
      return createEmptyTradeEditorState(createDefaultFundamentalDraft)
    })
    setDragOver(false)
    setParsing(false)
  }, [createDefaultFundamentalDraft])

  const setParsed = useCallback(
    (valueOrUpdater) => {
      updateActiveUpload((upload) => {
        const nextParsed =
          typeof valueOrUpdater === 'function' ? valueOrUpdater(upload.parsed) : valueOrUpdater
        return { ...upload, parsed: nextParsed }
      })
    },
    [updateActiveUpload]
  )

  const setTradeDate = useCallback(
    (value) => {
      updateActiveUpload((upload) => ({ ...upload, tradeDate: value }))
    },
    [updateActiveUpload]
  )

  const setMemoIn = useCallback(
    (valueOrUpdater) => {
      updateActiveUpload((upload) => ({
        ...upload,
        memoIn:
          typeof valueOrUpdater === 'function' ? valueOrUpdater(upload.memoIn) : valueOrUpdater,
      }))
    },
    [updateActiveUpload]
  )

  const setMemoStep = useCallback(
    (valueOrUpdater) => {
      updateActiveUpload((upload) => ({
        ...upload,
        memoStep:
          typeof valueOrUpdater === 'function' ? valueOrUpdater(upload.memoStep) : valueOrUpdater,
      }))
    },
    [updateActiveUpload]
  )

  const setMemoAns = useCallback(
    (valueOrUpdater) => {
      updateActiveUpload((upload) => ({
        ...upload,
        memoAns:
          typeof valueOrUpdater === 'function' ? valueOrUpdater(upload.memoAns) : valueOrUpdater,
      }))
    },
    [updateActiveUpload]
  )

  const resetActiveUploadMemo = useCallback(() => {
    updateActiveUpload((upload) => ({
      ...upload,
      memoStep: 0,
      memoAns: [],
      memoIn: '',
    }))
  }, [updateActiveUpload])

  const updateUploadById = useCallback((uploadId, updater) => {
    setTradeEditorState((prev) => ({
      ...prev,
      uploads: prev.uploads.map((upload) =>
        upload.id === uploadId
          ? typeof updater === 'function'
            ? updater(upload)
            : { ...upload, ...updater }
          : upload
      ),
    }))
  }, [])

  const parseUploadById = useCallback(
    async (uploadId) => {
      const upload = uploadsRef.current.find((u) => u.id === uploadId)
      if (!upload?.b64) return false
      if (isDemo) {
        flashSaved('🔒 訪客模式不能解析成交，請先用 Line 登入', 4000)
        return false
      }
      if (hasQuota === false) {
        flashSaved('📉 本期 AI 解析額度已用完，請升級方案後再試', 4500)
        return false
      }

      updateUploadById(uploadId, (u) => ({ ...u, parseErr: '' }))

      try {
        const data = await callEdge('checkup-parse', {
          body: {
            systemPrompt: PARSE_PROMPT,
            base64: upload.b64,
            mediaType: upload.mediaType || 'image/jpeg',
          },
          silent: true,
        })

        if (typeof applyQuotaFromResponse === 'function') applyQuotaFromResponse(data)

        const raw = String(data?.content?.[0]?.text || data?.text || '').trim()
        if (!raw) throw new Error('AI 未回傳可解析的內容')

        const repaired = parseJsonObject(raw)
        if (!repaired) {
          throw new Error('AI 回傳格式無法解析，請重新上傳更清晰的截圖')
        }

        const fallbackDate = upload.tradeDate || toSlashDate()
        const normalized = normalizeTradeParseResult(repaired, fallbackDate)
        if (!normalized.trades.length && !normalized.targetPriceUpdates.length) {
          throw new Error('沒有辨識到有效成交，請改用更清晰的截圖或手動修正')
        }

        updateUploadById(uploadId, (u) => ({
          ...u,
          parsed: normalized,
          parseErr: '',
          tradeDate: normalized.tradeDate || u.tradeDate || toSlashDate(),
          memoStep: 0,
          memoAns: [],
          memoIn: '',
        }))
        return true
      } catch (error) {
        console.error('parseShot error:', error)
        const msg =
          error?.body?.error === 'QUOTA_EXCEEDED'
            ? '本期 AI 解析額度已用完，請升級方案後再試'
            : error.message || '解析失敗，請確認截圖清晰'
        updateUploadById(uploadId, (u) => ({ ...u, parseErr: msg }))
        return false
      }
    },
    [applyQuotaFromResponse, flashSaved, hasQuota, isDemo, toSlashDate, updateUploadById]
  )

  const parseShot = useCallback(async () => {
    const id = uploadsRef.current.find((u) => u.id === tradeEditorState.activeUploadId)?.id
    if (!id) return
    setParsing(true)
    try {
      await parseUploadById(id)
    } finally {
      setParsing(false)
    }
  }, [parseUploadById, tradeEditorState.activeUploadId])

  const parseAllShots = useCallback(async () => {
    const targets = uploadsRef.current.filter((u) => !u.parsed?.trades?.length)
    if (!targets.length) return
    setParsing(true)
    setParseProgress({ current: 0, total: targets.length })
    try {
      let done = 0
      for (const u of targets) {
        // 序列跑避免 burst 429
        // eslint-disable-next-line no-await-in-loop
        await parseUploadById(u.id)
        done += 1
        setParseProgress({ current: done, total: targets.length })
      }
    } finally {
      setParsing(false)
      setParseProgress({ current: 0, total: 0 })
    }
  }, [parseUploadById])

  const retryParseUpload = useCallback(
    async (uploadId) => {
      if (!uploadId) return false
      setParsing(true)
      try {
        return await parseUploadById(uploadId)
      } finally {
        setParsing(false)
      }
    },
    [parseUploadById]
  )


  const parsed = activeUpload?.parsed || null
  const memoBatchMode = useMemo(() => getTradeBatchMode(parsed?.trades || []), [parsed])
  const memoQuestions = useMemo(() => MEMO_Q[memoBatchMode] || MEMO_Q['買進'], [memoBatchMode])

  // Snapshot of the last successfully written submitMemo, used by undoLastSubmit.
  // Cleared automatically after UNDO_WINDOW_MS or when a new submit happens.
  const lastSubmitRef = useRef(null)
  const UNDO_WINDOW_MS = 8000
  const [hasUndoableSubmit, setHasUndoableSubmit] = useState(false)
  const undoTimerRef = useRef(null)
  const isSubmittingRef = useRef(false)

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [])

  const submitMemo = useCallback(() => {
    if (isSubmittingRef.current) return
    if (!activeUpload?.parsed?.trades?.length) return
    isSubmittingRef.current = true
    // 釋放 lock：1500ms（OCR 後送出較慢，避免雙擊）
    setTimeout(() => { isSubmittingRef.current = false }, 1500)

    const nextAnswers = [...(activeUpload.memoAns || []), activeUpload.memoIn || '']
    if ((activeUpload.memoStep || 0) < memoQuestions.length - 1) {
      updateActiveUpload((upload) => ({
        ...upload,
        memoAns: nextAnswers,
        memoIn: '',
        memoStep: (upload.memoStep || 0) + 1,
      }))
      return
    }

    const selectedTradeDate = String(activeUpload.tradeDate || '').trim() || toSlashDate()
    const entries = buildTradeLogEntries({
      parsed: activeUpload.parsed,
      tradeDate: selectedTradeDate,
      memoQuestions,
      memoAnswers: nextAnswers,
      now: new Date(),
    })

    // 先計算下一個 holdings；任一步丟錯就整批 abort，不變動 tradeLog
    const prevHoldings = Array.isArray(holdings) ? holdings : []
    const prevTradeLog = Array.isArray(tradeLog) ? tradeLog : []
    let nextHoldings
    try {
      nextHoldings = applyParsedTradesToHoldings({
        holdings: prevHoldings,
        parsed: activeUpload.parsed,
        applyTradeEntryToHoldings,
        marketQuotes,
      })
    } catch (error) {
      console.error('Holdings update failed:', error)
      flashSaved('❌ 寫入失敗，未變動任何資料', 3500)
      return
    }

    const nextTradeLog = [...entries, ...prevTradeLog]

    // Snapshot before mutation — undo 還原 holdings + tradeLog 兩者
    const snapshot = {
      uploadDraft: { ...activeUpload, memoAns: nextAnswers, memoIn: '' },
      entryIds: entries.map((e) => e.id),
      parsed: activeUpload.parsed,
      timestamp: Date.now(),
      prevHoldings,
      prevTradeLog,
    }

    setHoldings(nextHoldings)
    setTradeLog(nextTradeLog)

    ;(activeUpload.parsed.targetPriceUpdates || []).forEach((update) => {
      upsertTargetReport(update)
    })

    const remainingUploads = Math.max(tradeEditorState.uploads.length - 1, 0)
    flashSaved(
      remainingUploads > 0
        ? `✅ 已寫入 ${entries.length} 筆成交，還有 ${remainingUploads} 張待處理`
        : `✅ 已寫入 ${entries.length} 筆成交（${Math.round(UNDO_WINDOW_MS / 1000)} 秒內可撤銷）`,
      3000
    )

    const processedUploadId = activeUpload.id
    snapshot.processedUploadId = processedUploadId
    lastSubmitRef.current = snapshot
    setHasUndoableSubmit(true)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => {
      lastSubmitRef.current = null
      setHasUndoableSubmit(false)
    }, UNDO_WINDOW_MS)

    removeUpload(processedUploadId)
    afterSubmit({
      processedTrades: entries.length,
      remainingUploads,
      processedUploadId,
    })
  }, [
    activeUpload,
    afterSubmit,
    applyTradeEntryToHoldings,
    flashSaved,
    holdings,
    marketQuotes,
    memoQuestions,
    removeUpload,
    setHoldings,
    setTradeLog,
    toSlashDate,
    tradeEditorState.uploads.length,
    tradeLog,
    updateActiveUpload,
    upsertTargetReport,
  ])

  const undoLastSubmit = useCallback(() => {
    const snap = lastSubmitRef.current
    if (!snap) return false

    // Restore full snapshots (holdings + tradeLog) — 比 entryId filter 更穩
    if (Array.isArray(snap.prevTradeLog)) {
      setTradeLog(snap.prevTradeLog)
    } else {
      const entryIdSet = new Set(snap.entryIds || [])
      setTradeLog((prev) => {
        const arr = Array.isArray(prev) ? prev : []
        return arr.filter((row) => !entryIdSet.has(row.id))
      })
    }
    if (Array.isArray(snap.prevHoldings)) {
      setHoldings(snap.prevHoldings)
    }
    // Restore the upload draft so user can re-edit answers.
    setTradeEditorState((prev) => ({
      ...prev,
      uploads: [snap.uploadDraft, ...prev.uploads],
      activeUploadId: snap.uploadDraft.id,
    }))

    lastSubmitRef.current = null
    setHasUndoableSubmit(false)
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    flashSaved('↺ 已撤銷上一筆成交寫入', 2500)
    return true
  }, [flashSaved, setHoldings, setTradeLog])

  return useMemo(
    () => ({
      img: activeUpload?.img || null,
      uploads: tradeEditorState.uploads,
      activeUploadId: tradeEditorState.activeUploadId,
      activeUploadIndex: tradeEditorState.uploads.findIndex(
        (upload) => upload.id === tradeEditorState.activeUploadId
      ),
      uploadCount: tradeEditorState.uploads.length,
      activeUploadName: activeUpload?.name || '',
      dragOver,
      setDragOver,
      processFile,
      processFiles,
      parseShot,
      parseAllShots,
      parsing,
      parseErr: activeUpload?.parseErr || null,
      parsed,
      setParsed,
      tradeDate: activeUpload?.tradeDate || toSlashDate(),
      setTradeDate,
      qs: memoQuestions,
      memoBatchMode,
      memoAns: activeUpload?.memoAns || [],
      setMemoAns,
      memoIn: activeUpload?.memoIn || '',
      setMemoIn,
      memoStep: activeUpload?.memoStep || 0,
      setMemoStep,
      submitMemo,
      undoLastSubmit,
      hasUndoableSubmit,
      selectUpload,
      removeUpload,
      clearUploads,
      resetTradeCapture,
      tpCode: tradeEditorState.tpCode,
      tpFirm: tradeEditorState.tpFirm,
      tpVal: tradeEditorState.tpVal,
      setTpCode: (value) => setTradeEditorState((prev) => ({ ...prev, tpCode: value })),
      setTpFirm: (value) => setTradeEditorState((prev) => ({ ...prev, tpFirm: value })),
      setTpVal: (value) => setTradeEditorState((prev) => ({ ...prev, tpVal: value })),
      fundamentalDraft: tradeEditorState.fundamentalDraft,
      setFundamentalDraft: (valueOrUpdater) =>
        setTradeEditorState((prev) => ({
          ...prev,
          fundamentalDraft:
            typeof valueOrUpdater === 'function'
              ? valueOrUpdater(prev.fundamentalDraft)
              : valueOrUpdater,
        })),
      upsertTargetReport,
      upsertFundamentalsEntry,
      createDefaultFundamentalDraft,
      toSlashDate,
      resetActiveUploadMemo,
    }),
    [
      activeUpload,
      createDefaultFundamentalDraft,
      dragOver,
      memoBatchMode,
      memoQuestions,
      parseShot,
      parseAllShots,
      parsed,
      parsing,
      processFile,
      processFiles,
      removeUpload,
      clearUploads,
      resetTradeCapture,
      resetActiveUploadMemo,
      selectUpload,
      setMemoAns,
      setMemoIn,
      setMemoStep,
      setParsed,
      setTradeDate,
      submitMemo,
      undoLastSubmit,
      hasUndoableSubmit,
      toSlashDate,
      tradeEditorState,
      upsertFundamentalsEntry,
      upsertTargetReport,
    ]
  )
}
