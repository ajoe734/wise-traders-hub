UPDATE public.trade_records tr
SET currency = 'USD', quantity_unit = '股'
FROM public.experts e
WHERE tr.expert_id = e.id
  AND e.asset_class = 'us_stock'
  AND (tr.currency <> 'USD' OR tr.quantity_unit <> '股')
  AND (tr.currency IS NOT NULL OR tr.quantity_unit IS NOT NULL);

UPDATE public.trade_records tr
SET quantity_unit = '顆'
FROM public.experts e
WHERE tr.expert_id = e.id AND e.asset_class = 'crypto'
  AND tr.quantity_unit IS NOT NULL AND tr.quantity_unit <> '顆';

UPDATE public.trade_records tr
SET quantity_unit = '口'
FROM public.experts e
WHERE tr.expert_id = e.id AND e.asset_class = 'us_future'
  AND tr.quantity_unit IS NOT NULL AND tr.quantity_unit <> '口';