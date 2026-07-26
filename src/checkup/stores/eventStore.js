/**
 * Event Store
 *
 * Manages event tracking state using Zustand.
 *
 * IMPORTANT: `newsEvents` defaults to `null` (not []). `null` is the
 * "not yet hydrated" sentinel used by usePortfolioPersistence and
 * to distinguish "no data loaded" from
 * "loaded empty". Selectors below tolerate null via `asArr`.
 */

import { create } from 'zustand';
import { DEFAULT_REVIEW_FORM, DEFAULT_NEW_EVENT } from '../constants.js';

const createDefaultReviewForm = (overrides = {}) => ({ ...DEFAULT_REVIEW_FORM, ...overrides });
const createDefaultEventDraft = (overrides = {}) => ({ ...DEFAULT_NEW_EVENT, ...overrides });

// Helpers — tolerate null because newsEvents starts null until bootstrap hydrates.
const asArr = (v) => (Array.isArray(v) ? v : []);

// Functional setter — supports both setX(value) and setX(prev => next),
// matching React's useState contract so call sites don't have to change.
const makeSetter = (key) => (set) => (next) =>
  set((state) =>
    typeof next === 'function' ? { [key]: next(state[key]) } : { [key]: next }
  );

// Initial state
const createInitialState = () => ({
  newsEvents: null,
  reviewingEvent: null,
  reviewForm: createDefaultReviewForm(),
  newEvent: createDefaultEventDraft(),
  showAddEvent: false,
  calendarMonth: (() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  })(),
  showCalendar: false,
  reversalConditions: {},
  filterType: '全部',
  expandedNews: new Set(),
  // Decision System v6
  userOverrides: {},
});

export const useEventStore = create((set, get) => ({
  // State
  ...createInitialState(),

  // Actions - Events (functional-update aware)
  setNewsEvents: makeSetter('newsEvents')(set),
  addEvent: (event) => set((state) => ({
    newsEvents: [event, ...asArr(state.newsEvents)],
  })),
  updateEvent: (eventId, updates) => set((state) => ({
    newsEvents: asArr(state.newsEvents).map(e =>
      e.id === eventId ? { ...e, ...updates } : e
    ),
  })),
  deleteEvent: (eventId) => set((state) => ({
    newsEvents: asArr(state.newsEvents).filter(e => e.id !== eventId),
  })),

  // Actions - Review
  setReviewingEvent: (reviewingEvent) => set({ reviewingEvent }),
  setReviewForm: (reviewForm) => set((state) => ({
    reviewForm: { ...state.reviewForm, ...reviewForm },
  })),
  submitReview: () => set({ reviewingEvent: null, reviewForm: createDefaultReviewForm() }),
  cancelReview: () => set({ reviewingEvent: null, reviewForm: createDefaultReviewForm() }),

  // Actions - New Event
  setNewEvent: (newEvent) => set({ newEvent }),
  setShowAddEvent: (showAddEvent) => set({ showAddEvent }),

  // Actions - Calendar
  setCalendarMonth: (calendarMonth) => set({ calendarMonth }),
  setShowCalendar: (showCalendar) => set({ showCalendar }),

  // Actions - Reversal
  setReversalConditions: (reversalConditions) => set({ reversalConditions }),
  updateReversalCondition: (code, condition) => set((state) => ({
    reversalConditions: { ...state.reversalConditions, [code]: condition },
  })),

  // Actions - Filter
  setFilterType: (filterType) => set({ filterType }),

  // Actions - Expanded News
  setExpandedNews: (expandedNews) => set({ expandedNews }),
  toggleExpandedNews: (newsId) => set((state) => {
    const next = new Set(state.expandedNews);
    if (next.has(newsId)) {
      next.delete(newsId);
    } else {
      next.add(newsId);
    }
    return { expandedNews: next };
  }),

  // Actions - User Overrides (Decision v6)
  setUserOverrides: (userOverrides) => set({ userOverrides }),
  setUserOverride: (code, override) => set((state) => ({
    userOverrides: { ...state.userOverrides, [code]: override },
  })),
  removeUserOverride: (code) => set((state) => {
    const next = { ...state.userOverrides };
    delete next[code];
    return { userOverrides: next };
  }),

  // Selectors (null-tolerant)
  getEventsByStatus: () => {
    const events = asArr(get().newsEvents);
    return {
      pending: events.filter(e => e.status === 'pending'),
      tracking: events.filter(e => e.status === 'tracking'),
      closed: events.filter(e => e.status === 'closed' || e.status === 'past'),
    };
  },

  getUrgentCount: () => {
    const events = asArr(get().newsEvents);
    const d = new Date();
    const today = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const isToday = (e) => [e?.date, e?.eventDate]
      .filter(Boolean)
      .some((v) => String(v).replace(/-/g, '/').slice(0, 10) === today);
    return events.filter(e => e.status === 'pending' && isToday(e)).length;
  },

  getTodayAlertSummary: () => {
    const events = asArr(get().newsEvents);
    const d = new Date();
    const today = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const isToday = (e) => [e?.date, e?.eventDate]
      .filter(Boolean)
      .some((v) => String(v).replace(/-/g, '/').slice(0, 10) === today);
    const todayEvents = events.filter(isToday);
    const pending = todayEvents.filter(e => e.status === 'pending').length;
    const tracking = todayEvents.filter(e => e.status === 'tracking').length;

    const parts = [];
    if (pending > 0) parts.push(`${pending} 待追蹤`);
    if (tracking > 0) parts.push(`${tracking} 進行中`);
    return parts.join(' · ') || '無事件';
  },

  // One-time hydration — only seeds keys that are still null/default (idempotent on remount)
  hydrateInitial: (data = {}) => set((state) => {
    const next = {};
    if (state.newsEvents == null && data.newsEvents !== undefined) {
      next.newsEvents = data.newsEvents;
    }
    return next;
  }),

  // Reset
  reset: () => set(createInitialState()),
}));
