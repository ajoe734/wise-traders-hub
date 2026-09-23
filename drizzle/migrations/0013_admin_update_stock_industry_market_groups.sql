CREATE OR REPLACE FUNCTION public.admin_update_stock_industry(
  _symbol text,
  _industries text[] DEFAULT NULL::text[],
  _themes text[] DEFAULT NULL::text[],
  _reviewed boolean DEFAULT true,
  _market_groups text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_row public.stock_industry_map%rowtype;
begin
  if not public.has_role(auth.uid(), 'company_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.stock_industry_map
     set industries    = coalesce(_industries, industries),
         themes        = coalesce(_themes, themes),
         market_groups = coalesce(_market_groups, market_groups),
         reviewed      = coalesce(_reviewed, reviewed),
         source        = case
                           when _industries is null and _themes is null and _market_groups is null
                           then source else 'admin'
                         end,
         updated_at    = now()
   where symbol = _symbol
  returning * into v_row;

  if not found then
    raise exception 'symbol % not found in stock_industry_map', _symbol;
  end if;

  return to_jsonb(v_row);
end;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_stock_industry(text, text[], text[], boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_stock_industry(text, text[], text[], boolean, text[]) TO authenticated, service_role;