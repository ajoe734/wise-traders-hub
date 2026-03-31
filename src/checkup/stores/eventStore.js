/**
 * Event Store
 * 
 * Manages event tracking state using Zustand
 */

import { create } from 'zustand';
import { DEFAULT_REVIEW_FORM, DEFAULT_NEW_EVENT } from '../constants.js';

const createDefaultReviewForm = (overrides = {}) => ({ ...DEFAULT_REVIEW_FORM, ...overrides });
const createDefaultEventDraft = (overrides = {}) => ({ ...DEFAULT_NEW_EVENT, ...overrides });

// Initial state
const createInitialState = () => ({
  newsEvents: [],
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
});

export const useEventStore = create((set, get) => ({
  // State
  ...createInitialState(),
  
  // Actions - Events
  setNewsEvents: (newsEvents) => set({ newsEvents }),
  addEvent: (event) => set((state) => ({ 
    newsEvents: [event, ...state.newsEvents] 
  })),
  updateEvent: (eventId, updates) => set((state) => ({
    newsEvents: state.newsEvents.map(e => 
      e.id === eventId ? { ...e, ...updates } : e
    )
  })),
  deleteEvent: (eventId) => set((state) => ({
    newsEvents: state.newsEvents.filter(e => e.id !== eventId)
  })),
  
  // Actions - Review
  setReviewingEvent: (reviewingEvent) => set({ reviewingEvent }),
  setReviewForm: (reviewForm) => set((state) => ({ 
    reviewForm: { ...state.reviewForm, ...reviewForm } 
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
    reversalConditions: { ...state.reversalConditions, [code]: condition }
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
  
  // Selectors
  getEventsByStatus: () => {
    const { newsEvents } = get();
    return {
      pending: newsEvents.filter(e => e.status === 'pending'),
      tracking: newsEvents.filter(e => e.status === 'tracking'),
      closed: newsEvents.filter(e => e.status === 'closed' || e.status === 'past'),
    };
  },
  
  getUrgentCount: () => {
    const { newsEvents } = get();
    const today = new Date().toISOString().slice(0, 10);
    return newsEvents.filter(e => e.status === 'pending' && e.eventDate === today).length;
  },
  
  getTodayAlertSummary: () => {
    const { newsEvents } = get();
    const today = new Date().toISOString().slice(0, 10);
    const todayEvents = newsEvents.filter(e => e.eventDate === today);
    const pending = todayEvents.filter(e => e.status === 'pending').length;
    const tracking = todayEvents.filter(e => e.status === 'tracking').length;
    
    const parts = [];
    if (pending > 0) parts.push(`${pending} 待追蹤`);
    if (tracking > 0) parts.push(`${tracking} 進行中`);
    return parts.join(' · ') || '無事件';
  },
  
  // Reset
  reset: () => set(createInitialState()),
}));
