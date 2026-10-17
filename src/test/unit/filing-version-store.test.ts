import { describe,it,expect } from 'vitest';
import { readFilingVersions,commitFiling } from '../../../supabase/functions/_shared/filingVersionStore';

const fs = [{date:'2026-09-30',type:'EPS',value:3},{date:'2026-09-30',type:'Revenue',value:300}];
const bs = [{date:'2026-09-30',type:'OrdinaryShare',value:100},{date:'2026-09-30',type:'Equity',value:500}];
describe('財報版本儲存與失敗', () => {
  it('1977 檔全部分頁讀取，不漏第1001檔以後',async () => {
    const calls: number[]=[];
    const db={from:()=>({select:()=>({order:()=>({range:async (a:number,b:number)=>{calls.push(a);return {data:Array.from({length:Math.min(1977-a,b-a+1)},(_,i)=>({symbol:String(a+i)})),error:null};}})})})};
    const r=await readFilingVersions(db);
    expect(r).toHaveLength(1977);expect(calls).toEqual([0,1000]);expect(r.at(-1).symbol).toBe('1976');
  });
  it('任一分頁讀取失敗不能當作空佇列',async () => {
    const db={from:()=>({select:()=>({order:()=>({range:async ()=>({data:null,error:{message:'offline'}})})})})};
    await expect(readFilingVersions(db)).rejects.toThrow('offline');
  });
  it('缺新季資料不寫 ready；完整新季可提交；寫入失敗向外回報',async () => {
    const rows:any[]=[];
    const db={from:()=>({}),rpc:async (_:string,r:any)=>{rows.push(r);return {data:true,error:null};}};
    await expect(commitFiling(db,'1234',fs,[],'2026-09-30',null,null,'official-v1')).rejects.toThrow();
    expect(rows).toHaveLength(0);
    await commitFiling(db,'1234',fs,bs,'2026-09-30',null,null,'official-v1');
    expect(rows[0]).toMatchObject({_latest:'2026-09-30',_statements:fs,_balance_sheet:bs,_source:'official-v1'});
    const broken={from:()=>({}),rpc:async ()=>({data:null,error:{message:'write failed'}})};
    await expect(commitFiling(broken,'1234',fs,bs,'2026-09-30',null,null,'official-v1')).rejects.toThrow('write failed');
  });
  it('同季修訂上游仍舊版時不寫新完成時間',async () => {
    const rows:any[]=[];
    const db={from:()=>({}),rpc:async (_:string,r:any)=>{rows.push(r);return {data:true,error:null};}};
    await commitFiling(db,'1234',fs,bs,'2026-09-30',null,null,'official-v1');
    await expect(commitFiling(db,'1234',fs,bs,'2026-09-30',rows[0]._version,'2026-09-30','official-v2')).rejects.toThrow('舊版本');
    expect(rows).toHaveLength(1);
  });
});