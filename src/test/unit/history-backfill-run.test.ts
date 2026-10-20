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