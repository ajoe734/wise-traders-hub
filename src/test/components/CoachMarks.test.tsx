import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";

// §6.5：CoachMarks 已被 OnboardingOverlay 三步文案卡取代，
// 元件永遠 render null。此測試檔保留為「不可回退」防禦，
// 確保不會有人不小心重啟舊版全屏遮罩教學氣泡。
vi.mock("@/checkup/contexts/CheckupModeContext.jsx", () => ({
  useCheckupMode: () => ({ isDemo: false, isReady: true }),
  CheckupModeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { vi } from "vitest";
import { CoachMarks } from "@/checkup/components/CoachMarks";

describe("CoachMarks (deprecated)", () => {
  it("元件已下線，任何情境下都 render null（避免舊版全屏遮罩回歸）", () => {
    const { container } = render(<CoachMarks onTabChange={() => {}} />);
    act(() => {}); // flush
    expect(container.firstChild).toBeNull();
  });

  it("即使 localStorage 沒 flag 也不會彈出 dialog", () => {
    localStorage.removeItem("checkup-coach-seen-v1");
    const { container } = render(<CoachMarks onTabChange={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
