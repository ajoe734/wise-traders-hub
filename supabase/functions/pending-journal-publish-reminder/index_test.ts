import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { reminderWeekStart } from './index.ts';

Deno.test('Sunday reminder uses current Taipei week', () => {
  assertEquals(reminderWeekStart(new Date('2026-07-26T12:00:00Z')), '2026-07-20');
});

Deno.test('Monday 07:00 Taipei reminder still uses previous week', () => {
  assertEquals(reminderWeekStart(new Date('2026-07-26T23:00:00Z')), '2026-07-20');
});

Deno.test('Monday 08:00 Taipei moves to new week', () => {
  assertEquals(reminderWeekStart(new Date('2026-07-27T00:00:00Z')), '2026-07-27');
});