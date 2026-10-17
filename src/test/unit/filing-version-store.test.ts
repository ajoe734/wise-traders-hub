import { describe,it,expect } from 'vitest';
import { readFilingVersions,commitFiling,readSalesBases } from '../../../supabase/functions/_shared/filingVersionStore';

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
describe('版本穩定與完整同業分頁', () => {
  it('同季資料順序改變不冒充新修訂', async () => {
    let version = '';
    const db = { from: () => ({}), rpc: async (_: string,r: any) => { version = r._version; return {data:true,error:null}; } };
    await commitFiling(db,'1234',fs,bs,'2026-09-30',null,null,'source');
    await expect(commitFiling(db,'1234',[...fs].reverse(),[...bs].reverse(),'2026-09-30',version,'2026-09-30','revised')).rejects.toThrow('舊版本');
  });
  it('並發來源已更新不宣稱提交成功', async () => {
    const db = { from: () => ({}),rpc: async () => ({data:false,error:null}) };
    await expect(commitFiling(db,'1234',fs,bs,'2026-09-30',null,null,'source')).rejects.toThrow('保留重試');
  });
  it('同業分母讀滿1001檔且只讀可用資料', async () => {
    const db = { from: () => ({select:()=>({eq:(key:string,value:boolean)=>{expect(key).toBe('eligible');expect(value).toBe(true);return {order:()=>({range:async(a:number,b:number)=>({data:Array.from({length:Math.min(1001-a,b-a+1)},(_,i)=>({symbol:String(a+i)})),error:null})})};}})}) };
    expect(await readSalesBases(db)).toHaveLength(1001);
  });
});
