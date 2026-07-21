import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { CoachMarks } from '@/checkup/components/CoachMarks';

// Mock useCheckupMode 以便切換 isDemo / isReady
const modeMock = vi.fn();
vi.mock('@/checkup/contexts/CheckupModeContext.jsx', () => ({
  useCheckupMode: () => modeMock(),
}));

const COACH_KEY = 'checkup-coach-seen-v1';

// §6.5：CoachMarks 已由 OnboardingOverlay 三步文案卡取代，
// 元件永遠 return null。以下用例守住「不可回退」門檻，
// 確保沒有人不小心重啟舊版氣泡或全屏遮罩。
describe('CoachMarks gating (deprecated — must stay null)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(COACH_KEY);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    localStorage.removeItem(COACH_KEY);
  });

  for (const scenario of [
    { name: 'isReady=false', ret: { isDemo: true, isReady: false } },
    { name: '非 demo + isReady=true', ret: { isDemo: false, isReady: true } },
    { name: 'demo + isReady=true', ret: { isDemo: true, isReady: true } },
  ]) {
    it(`${scenario.name} → 永遠不 render dialog`, () => {
      modeMock.mockReturnValue(scenario.ret);
      render(<CoachMarks onTabChange={() => {}} />);
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();
      // scroll / tab-change 事件也不該喚醒
      Object.defineProperty(window, 'scrollY', { value: 500, writable: true, configurable: true });
      act(() => {
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new CustomEvent('checkup:tab-change'));
      });
      expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();
    });
  }

  it('unmount 後不留 listener（重複觸發不會 throw）', () => {
    modeMock.mockReturnValue({ isDemo: true, isReady: true });
    const { unmount } = render(<CoachMarks onTabChange={() => {}} />);
    act(() => { vi.advanceTimersByTime(100); });
    unmount();
    Object.defineProperty(window, 'scrollY', { value: 500, writable: true, configurable: true });
    expect(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new CustomEvent('checkup:tab-change'));
    }).not.toThrow();
  });
});
