import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MEMO_Q, PARSE_PROMPT } from '../constants.js'
import {
  applyParsedTradesToHoldings,
  buildTradeLogEntries,
  getTradeBatchMode,
  normalizeTradeParseResult,
} from '../lib/tradeParseUtils.js'

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
  setHoldings = () => {},
  setTradeLog = () => {},
  upsertTargetReport = () => false,
  upsertFundamentalsEntry = () => false,
  applyTradeEntryToHoldings = (rows) => rows,
  createDefaultFundamentalDraft = () => ({}),
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
  flashSaved = () => {},
  afterSubmit = () => {},
}) {
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
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
      const files = Array.from(incomingFiles || []).filter((file) =>
        file?.type?.startsWith('image/')
      )
      if (!files.length) return

      try {
        const nextUploads = await Promise.all(
          files.map(async (file) => {
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
    [flashSaved, toSlashDate]
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

  const parseShot = useCallback(async () => {
    if (!activeUpload?.b64) return
    setParsing(true)
    updateActiveUpload((upload) => ({ ...upload, parseErr: '' }))

    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: PARSE_PROMPT,
          base64: activeUpload.b64,
          mediaType: activeUpload.mediaType,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || data.error || 'API 錯誤')

      const clean = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim()
      if (!clean) throw new Error('AI 未回傳可解析的內容')

      const normalized = normalizeTradeParseResult(
        JSON.parse(clean),
        activeUpload.tradeDate || toSlashDate()
      )
      if (!normalized.trades.length && !normalized.targetPriceUpdates.length) {
        throw new Error('沒有辨識到有效成交，請改用更清晰的截圖或手動修正')
      }

      updateActiveUpload((upload) => ({
        ...upload,
        parsed: normalized,
        parseErr: '',
        tradeDate: normalized.tradeDate || upload.tradeDate || toSlashDate(),
        memoStep: 0,
        memoAns: [],
        memoIn: '',
      }))
    } catch (error) {
      console.error('parseShot error:', error)
      updateActiveUpload((upload) => ({
        ...upload,
        parseErr: error.message || '解析失敗，請確認截圖清晰',
      }))
    } finally {
      setParsing(false)
    }
  }, [activeUpload, toSlashDate, updateActiveUpload])

  const parsed = activeUpload?.parsed || null
  const memoBatchMode = useMemo(() => getTradeBatchMode(parsed?.trades || []), [parsed])
  const memoQuestions = useMemo(() => MEMO_Q[memoBatchMode] || MEMO_Q['買進'], [memoBatchMode])

  const submitMemo = useCallback(() => {
    if (!activeUpload?.parsed?.trades?.length) return

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

    setHoldings((prev) => {
      try {
        return applyParsedTradesToHoldings({
          holdings: Array.isArray(prev) ? prev : holdings,
          parsed: activeUpload.parsed,
          applyTradeEntryToHoldings,
          marketQuotes,
        })
      } catch (error) {
        console.error('Holdings update failed:', error)
        return Array.isArray(prev) ? prev : holdings
      }
    })

    setTradeLog((prev) => [...entries, ...(Array.isArray(prev) ? prev : tradeLog)])

    ;(activeUpload.parsed.targetPriceUpdates || []).forEach((update) => {
      upsertTargetReport(update)
    })

    const remainingUploads = Math.max(tradeEditorState.uploads.length - 1, 0)
    flashSaved(
      remainingUploads > 0
        ? `✅ 已寫入 ${entries.length} 筆成交，還有 ${remainingUploads} 張待處理`
        : `✅ 已寫入 ${entries.length} 筆成交`,
      3000
    )

    const processedUploadId = activeUpload.id
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
      toSlashDate,
      tradeEditorState,
      upsertFundamentalsEntry,
      upsertTargetReport,
    ]
  )
}
