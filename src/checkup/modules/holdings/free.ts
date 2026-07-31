// M1 Holdings —— free surface（ADR-0005）
// 免費版單頁 `/holding-checkup` 專用表面。呼叫端只有 shell（src/pages/FreeCheckup.jsx），
// 且一律 lazy import 以保住 code splitting。
export { default as HoldingsTab } from '../../components/freecheckup/HoldingsTab';
export { default as HoldingCard } from '../../components/freecheckup/HoldingCard';
export { default as HoldingsDetailPanel, RangeBand } from '../../components/freecheckup/HoldingsDetailPanel';
export { default as HoldingsWorkbench } from '../../components/freecheckup/HoldingsWorkbench';
export { default as HoldingsHero } from '../../components/freecheckup/HoldingsHero';
export { default as HoldingsSectorSummary } from '../../components/freecheckup/HoldingsSectorSummary';
export { default as HoldingsFilterBar } from '../../components/freecheckup/HoldingsFilterBar';
export { default as HoldingsFooterBar } from '../../components/freecheckup/HoldingsFooterBar';
export { default as HoldingsQuotaMeter } from '../../components/freecheckup/HoldingsQuotaMeter';
export { default as HoldingsEmptyState } from '../../components/freecheckup/HoldingsEmptyState';
export { default as HoldingsNoMatchState } from '../../components/freecheckup/HoldingsNoMatchState';
export { default as HoldingsActionPriority } from '../../components/freecheckup/HoldingsActionPriority';
export { default as HoldingsReversalSection } from '../../components/freecheckup/HoldingsReversalSection';
export { default as HoldingsUploadSummary } from '../../components/freecheckup/HoldingsUploadSummary';
export { default as HoldingExportCard } from '../../components/freecheckup/HoldingExportCard';
export { default as HoldingMetaReportModal } from '../../components/freecheckup/HoldingMetaReportModal';
export { default as ChipsSection, getInstReadiness } from '../../components/freecheckup/ChipsSection';
export { default as ChipsTrendChart } from '../../components/freecheckup/ChipsTrendChart';
export { bsrHeaderLabel, fmtNextRun } from '../../components/freecheckup/bsrHeaderLabel';
export { computeScenario, isDirty } from '../../components/freecheckup/holdingScenario';
// _ui/* 只有 M1 使用，直接歸 M1（ADR-0005 §4）
export { ActionBadge } from '../../components/freecheckup/_ui/ActionBadge';
export { PriceTrack } from '../../components/freecheckup/_ui/PriceTrack';
export { ReturnBar } from '../../components/freecheckup/_ui/ReturnBar';
export { SectionRule } from '../../components/freecheckup/_ui/SectionRule';
export { HoldingCardHeader, getFallbackTip } from '../../components/freecheckup/_ui/holdingCard/HoldingCardHeader';
export { HoldingCardFooter } from '../../components/freecheckup/_ui/holdingCard/HoldingCardFooter';
export { HoldingCardReturn } from '../../components/freecheckup/_ui/holdingCard/HoldingCardReturn';
export { HoldingCardPriceTrack } from '../../components/freecheckup/_ui/holdingCard/HoldingCardPriceTrack';
export { default as HoldingCardSkeleton } from '../../components/freecheckup/_ui/holdingCard/HoldingCardSkeleton';
// 抽屜的狀態組裝 hook 只服務 free surface 的 HoldingsDetailPanel（ADR-0005 §6）
export { useHoldingDetailViewModel } from '../../hooks/useHoldingDetailViewModel';
