import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// CoachMarks 現在依賴 CheckupModeContext 的 isReady/isDemo 決策：
// - isReady=false 時整個 useEffect 直接 return，dialog 不會掛出來；
// - isDemo=true 時要 scroll>200 或 tab 切換才觸發，跟這組單元測試想驗證的
//   「非 demo mount 即彈」不吻合。
// 這裡把 hook mock 成 isReady:true / isDemo:false，讓 600ms 延遲觸發成立。
vi.mock("@/checkup/contexts/CheckupModeContext.jsx", () => ({
  useCheckupMode: () => ({ isDemo: false, isReady: true }),
  CheckupModeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { CoachMarks } from "@/checkup/components/CoachMarks";

describe("CoachMarks", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render the full-screen blocking overlay (must not cover the page)", () => {
    const { container } = render(<CoachMarks onTabChange={() => {}} />);
    act(() => { vi.advanceTimersByTime(800); });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const style = (dialog as HTMLElement).getAttribute("style") || "";
    // The previous version used inset:0 + black overlay which blocked the upgrade CTA.
    expect(style).not.toMatch(/inset:\s*0/);
    expect(style).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.55\)/);
  });

  it("does not mount when localStorage flag is set", () => {
    localStorage.setItem("checkup-coach-seen-v1", "1");
    const { container } = render(<CoachMarks onTabChange={() => {}} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("clicking 略過 stores the flag and unmounts the dialog", () => {
    const { container } = render(<CoachMarks onTabChange={() => {}} />);
    act(() => { vi.advanceTimersByTime(800); });
    const skipBtn = screen.getByRole("button", { name: "略過導覽" });
    act(() => { skipBtn.click(); });
    expect(localStorage.getItem("checkup-coach-seen-v1")).toBe("1");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
