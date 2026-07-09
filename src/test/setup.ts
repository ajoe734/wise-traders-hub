import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import React from 'react';

afterEach(() => {
  cleanup();
});

// Global mock: react-helmet-async。多數元件測試沒有自帶 HelmetProvider，
// 直接讓 <Helmet> 變 no-op、HelmetProvider/HelmetData 變 passthrough，
// 避免 HelmetDispatcher.init 存取 undefined context 拋錯。
vi.mock('react-helmet-async', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children ?? null);
  return {
    Helmet: Passthrough,
    HelmetProvider: Passthrough,
    HelmetData: class {
      context = {};
    },
  };
});

// window.matchMedia — jsdom 缺這個 API，很多 responsive/theme hook 需要。
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
