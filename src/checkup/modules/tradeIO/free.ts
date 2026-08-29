// M4 TradeIO —— free surface（ADR-0005）
export { default as TradeTab } from '../../components/freecheckup/TradeTab';
export { default as LogTab } from '../../components/freecheckup/LogTab';
export { default as TradeUploadModal } from '../../components/freecheckup/TradeUploadModal';
export { default as BatchParsePanel } from '../../components/freecheckup/BatchParsePanel';
// ManualTradeForm 必須留在 free surface：ADR-0005 R5 要求 freecheckup/ 下每個檔案
// 都由某個模組的 free surface 擁有（R5_UNOWNED_FREE_FILE）。實際 render 的 consumer
// 是同模組的 TradeTab.jsx，測試則一律經由這裡取用。
export { default as ManualTradeForm } from '../../components/freecheckup/ManualTradeForm';



