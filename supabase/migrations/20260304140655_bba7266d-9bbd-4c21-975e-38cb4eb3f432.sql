
-- Add strategy_summary column to experts table
ALTER TABLE public.experts ADD COLUMN strategy_summary text;

-- Initialize strategy_summary for 趙鵬博 (advisor)
UPDATE public.experts SET strategy_summary = '以技術分析為核心，結合籌碼面與消息面進行短中線操作。主要聚焦台股中小型股，透過嚴格的停損紀律與資金控管，追求穩定的超額報酬。擅長趨勢突破與型態學，搭配量價關係判斷進出場時機。' WHERE id = 'a1000000-0000-0000-0000-000000000001';

-- Initialize strategy_summary for 林修齊 (mentor)
UPDATE public.experts SET strategy_summary = '融合價值投資與動能策略，專注於基本面良好且具備技術面轉強訊號的標的。採用週線級別的波段操作，持股週期約 2-8 週。強調風險報酬比與倉位管理，以系統化的方式降低人為情緒干擾。' WHERE id = 'b1000000-0000-0000-0000-000000000001';
