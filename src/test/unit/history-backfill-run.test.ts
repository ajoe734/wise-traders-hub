import { it, expect } from 'vitest';
import { runHistoryBackfill } from '../../../supabase/functions/_shared/historyBackfillRunner';

it('額度耗盡仍保留重試且不把股票標完成', async () => {
  const outcomes: Array<{symbol:string;outcome:string}> = [];
  const db = {
    rpc: async (name:string, args?:Record<string,unknown>) => name==='claim_history_backfill'
      ? {data:[{symbol:'2330',lease_token:'a'},{symbol:'1101',lease_token:'b'}],error:null}
      : name==='finish_history_backfill'
        ? (outcomes.push({symbol:String(args?.p_symbol),outcome:String(args?.p_outcome)}), {data:{applied:true},error:null})
        : {data:{remaining:2,scheduled:true},error:null},
    from: () => { throw new Error('quota must not write prices'); },
  };
  const result = await runHistoryBackfill(db, { prices:async()=>{throw new Error('QUOTA');}, revenue:async()=>[], isQuota:(e)=>e instanceof Error && e.message==='QUOTA' }, 40);
  expect({done:result.done,stopped:result.stoppedForQuota,outcomes}).toEqual({done:0,stopped:true,outcomes:[{symbol:'2330',outcome:'quota'},{symbol:'1101',outcome:'release'}]});
});

function harness(options: { writeError?: string; readyError?: string } = {}) {
  const outcomes: string[] = [];
  const stored: unknown[] = [];
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name==='claim_history_backfill') return { data:[{symbol:'1101',lease_token:'a'}],error:null };
      if (name==='finish_history_backfill') {
        if(args?.p_outcome==='ready' && options.readyError) return {data:null,error:{message:options.readyError}};
        outcomes.push(String(args?.p_outcome)); return {data:{applied:true},error:null};
      }
      return {data:{remaining:outcomes.includes('ready')?0:1,scheduled:!outcomes.includes('ready')},error:null};
    },
    from: () => ({upsert:async(rows:unknown[])=>{ if(options.writeError) return {error:{message:options.writeError}}; stored.push(...rows); return {error:null}; }}),
  };
  const price = {date:'2026-10-19',open:90,max:110,min:80,close:100,Trading_Volume:3000};
  return {db,outcomes,stored,price};
}

it('成功寫入真實日線並通過資料庫驗收才完成，营收無資料不偽造',async()=>{
 const h=harness();
 const r=await runHistoryBackfill(h.db,{prices:async()=>[h.price],revenue:async()=>[],isQuota:()=>false});
 expect({done:r.done,symbols:r.completedSymbols,outcomes:h.outcomes,stored:h.stored,status:r.status}).toEqual({done:1,symbols:['1101'],outcomes:['ready'],stored:[{symbol:'1101',trade_date:'2026-10-19',open:90,high:110,low:80,close:100,volume:3000,source:'finmind_price'}],status:{remaining:0,scheduled:false}});
});
it.each(['upstream','write','insufficient'])('%s 失敗不標完成並保留重試',async(kind)=>{
 const h=harness(kind==='write'?{writeError:'write failed'}:kind==='insufficient'?{readyError:'incomplete persisted history'}:{});
 const r=await runHistoryBackfill(h.db,{prices:async()=>{if(kind==='upstream')throw new Error('upstream failed');return [h.price];},revenue:async()=>[],isQuota:()=>false});
 expect({done:r.done,failed:r.failed.length,outcomes:h.outcomes,status:r.status}).toEqual({done:0,failed:1,outcomes:['failed'],status:{remaining:1,scheduled:true}});
});
it('營收請求耗盡額度，已抓到的日線仍寫入但不假標完成',async()=>{
 const h=harness();
 const r=await runHistoryBackfill(h.db,{prices:async()=>[h.price],revenue:async()=>{throw new Error('QUOTA');},isQuota:e=>e instanceof Error&&e.message==='QUOTA'});
 expect({done:r.done,quota:r.stoppedForQuota,bars:h.stored.length,outcomes:h.outcomes}).toEqual({done:0,quota:true,bars:1,outcomes:['quota']});
});