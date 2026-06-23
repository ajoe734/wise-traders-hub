import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoachMarks } from '@/checkup/components/CoachMarks';

// Mock useCheckupMode 以便切換 isDemo / isReady
const modeMock = vi.fn();
vi.mock('@/checkup/contexts/CheckupModeContext.jsx', () => ({
  useCheckupMode: () => modeMock(),
}));

const COACH_KEY = 'checkup-coach-seen-v1';

describe('CoachMarks gating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(COACH_KEY);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    localStorage.removeItem(COACH_KEY);
  });

  it('isReady=false → 完全不渲染（避免閃現）', () => {
    modeMock.mockReturnValue({ isDemo: true, isReady: false });
    render(<CoachMarks />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();
  });

  it('非 demo + 首次：mount 後 600ms 自動彈出（行為不變）', () => {
    modeMock.mockReturnValue({ isDemo: false, isReady: true });
    render(<CoachMarks />);
    expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.getByTestId('coachmarks-dialog')).toBeInTheDocument();
  });

  it('非 demo + 已看過：永不彈', () => {
    localStorage.setItem(COACH_KEY, '1');
    modeMock.mockReturnValue({ isDemo: false, isReady: true });
    render(<CoachMarks />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();
  });

  it('demo + 首次：mount 時不彈；scroll>200 才彈', () => {
    modeMock.mockReturnValue({ isDemo: true, isReady: true });
    render(<CoachMarks />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();

    // scrollY=150 → 不觸發
    Object.defineProperty(window, 'scrollY', { value: 150, writable: true, configurable: true });
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();

    // scrollY=300 → 觸發
    Object.defineProperty(window, 'scrollY', { value: 300, writable: true, configurable: true });
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(screen.getByTestId('coachmarks-dialog')).toBeInTheDocument();
  });

  it('demo：切 tab 也能觸發（checkup:tab-change 事件）', () => {
    modeMock.mockReturnValue({ isDemo: true, isReady: true });
    render(<CoachMarks />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();

    act(() => { window.dispatchEvent(new CustomEvent('checkup:tab-change')); });
    expect(screen.getByTestId('coachmarks-dialog')).toBeInTheDocument();
  });

  it('demo：觸發後 scroll 不重複彈（listener 已移除）', async () => {
    modeMock.mockReturnValue({ isDemo: true, isReady: true });
    render(<CoachMarks />);
    act(() => { vi.advanceTimersByTime(100); });

    Object.defineProperty(window, 'scrollY', { value: 500, writable: true, configurable: true });
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(screen.getByTestId('coachmarks-dialog')).toBeInTheDocument();

    // 關閉
    vi.useRealTimers();
    await userEvent.click(screen.getByRole('button', { name: /略過導覽/ }));
    expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();

    // 再 scroll：不該重彈
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(screen.queryByTestId('coachmarks-dialog')).toBeNull();
  });

  it('unmount 後 scroll listener 已 cleanup（不再 setState）', () => {
    modeMock.mockReturnValue({ isDemo: true, isReady: true });
    const { unmount } = render(<CoachMarks />);
    act(() => { vi.advanceTimersByTime(100); });
    unmount();

    // unmount 後 dispatch 不應 throw（listener 已移除）
    Object.defineProperty(window, 'scrollY', { value: 500, writable: true, configurable: true });
    expect(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new CustomEvent('checkup:tab-change'));
    }).not.toThrow();
  });
});
