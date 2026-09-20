import { describe, it, expect } from 'vitest';
import {
  normalizeDisplayName,
  emailLocalPart,
  isVirtualLineEmail,
  findDuplicateIdentityClusters,
  indexClustersByUser,
  type AccountRow,
} from '@/lib/duplicateIdentity';

const acc = (p: Partial<AccountRow> & { user_id: string }): AccountRow => ({
  email: '',
  display_name: null,
  is_line: false,
  line_user_id: null,
  last_sign_in_at: null,
  ...p,
});

describe('normalizeDisplayName', () => {
  it('抽出中文姓名，忽略英文前綴、空白與 emoji', () => {
    expect(normalizeDisplayName('Charlene 邱郁惠 🎀')).toBe('邱郁惠');
    expect(normalizeDisplayName('邱郁惠')).toBe('邱郁惠');
  });
  it('純英文名以小寫英數比對', () => {
    expect(normalizeDisplayName('John Doe!')).toBe('johndoe');
  });
  it('空值回空字串', () => {
    expect(normalizeDisplayName(null)).toBe('');
  });
});

describe('emailLocalPart / isVirtualLineEmail', () => {
  it('LINE 虛擬信箱不具識別意義', () => {
    expect(isVirtualLineEmail('line_u079@line.local')).toBe(true);
    expect(emailLocalPart('line_u079@line.local')).toBe('');
  });
  it('去掉 +tag 並小寫', () => {
    expect(emailLocalPart('AJV1005+shop@gmail.com')).toBe('ajv1005');
  });
});

describe('findDuplicateIdentityClusters', () => {
  const emailAcct = acc({ user_id: 'u-email', email: 'ajv1005@gmail.com', display_name: '邱郁惠' });
  const lineAcct = acc({
    user_id: 'u-line',
    email: 'line_u0796@line.local',
    display_name: 'Charlene 邱郁惠 🎀',
    is_line: true,
    line_user_id: 'u0796884006c10acb328b3c6687bacc1c',
  });

  it('中文姓名含英文前綴仍判定為同一人，並標示誰有訂閱', () => {
    const clusters = findDuplicateIdentityClusters([emailAcct, lineAcct], ['u-email']);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reasons).toContain('display_name');
    expect(clusters[0].members.map((m) => m.user_id).sort()).toEqual(['u-email', 'u-line']);
    expect(clusters[0].members[0]).toMatchObject({ user_id: 'u-email', has_subscription: true });
    expect(clusters[0].members[1].has_subscription).toBe(false);
  });

  it('同一個 line_user_id 即使名稱不同也判定為同一人', () => {
    const a = acc({ user_id: 'a', email: 'a@x.com', display_name: '甲', line_user_id: 'L1' });
    const b = acc({ user_id: 'b', email: 'line_x@line.local', display_name: '乙', is_line: true, line_user_id: 'L1' });
    const clusters = findDuplicateIdentityClusters([a, b], ['a']);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reasons).toContain('line_user_id');
  });

  it('Email 本地部分相同（不同網域）判定為同一人', () => {
    const a = acc({ user_id: 'a', email: 'ajv1005@gmail.com', display_name: '甲乙' });
    const b = acc({ user_id: 'b', email: 'ajv1005@yahoo.com.tw', display_name: '丙丁' });
    const clusters = findDuplicateIdentityClusters([a, b], ['a']);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reasons).toEqual(['email_local']);
  });

  it('完全不同的兩人不得誤判', () => {
    const a = acc({ user_id: 'a', email: 'alice@x.com', display_name: '王小明' });
    const b = acc({ user_id: 'b', email: 'bob@y.com', display_name: '陳大文' });
    expect(findDuplicateIdentityClusters([a, b], ['a'])).toEqual([]);
  });

  it('單字姓名不得因互相包含而誤判', () => {
    const a = acc({ user_id: 'a', email: 'a@x.com', display_name: '王' });
    const b = acc({ user_id: 'b', email: 'b@y.com', display_name: '王小明' });
    expect(findDuplicateIdentityClusters([a, b], ['a'])).toEqual([]);
  });

  it('兩邊都有訂閱不列入', () => {
    expect(findDuplicateIdentityClusters([emailAcct, lineAcct], ['u-email', 'u-line'])).toEqual([]);
  });

  it('兩邊都沒訂閱不列入', () => {
    expect(findDuplicateIdentityClusters([emailAcct, lineAcct], [])).toEqual([]);
  });

  it('LINE 虛擬信箱不得把所有 LINE 帳號黏成一群', () => {
    const a = acc({ user_id: 'a', email: 'line_aaa@line.local', display_name: '甲甲', is_line: true });
    const b = acc({ user_id: 'b', email: 'line_bbb@line.local', display_name: '乙乙', is_line: true });
    expect(findDuplicateIdentityClusters([a, b], ['a'])).toEqual([]);
  });

  it('indexClustersByUser 讓每個成員都查得到同一個群集', () => {
    const clusters = findDuplicateIdentityClusters([emailAcct, lineAcct], ['u-email']);
    const idx = indexClustersByUser(clusters);
    expect(idx['u-email']).toBe(idx['u-line']);
  });
});
