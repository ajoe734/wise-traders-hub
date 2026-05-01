/**
 * Demo 模擬：讓訪客模式的 AI 體驗看起來「像真的在跑」。
 * - demoDelay：隨機 1.5–3 秒延遲
 * - simulateSteps：依序顯示步驟文案 + 延遲（搭配既有 setStep）
 * 這些函式只在 isDemo === true 時呼叫，正式模式絕不引用。
 */

export const demoDelay = (min = 1500, max = 3000) =>
  new Promise((r) => setTimeout(r, min + Math.random() * Math.max(0, max - min)));

/**
 * @param {Array<{label:string, min?:number, max?:number}>} steps
 * @param {(label:string)=>void} setStep
 */
export async function simulateSteps(steps, setStep) {
  for (const s of steps) {
    if (typeof setStep === 'function') setStep(s.label);
    await demoDelay(s.min ?? 800, s.max ?? 1600);
  }
}
