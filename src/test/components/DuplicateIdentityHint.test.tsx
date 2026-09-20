import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DuplicateIdentityHint } from '@/components/company/DuplicateIdentityHint';
import { findDuplicateIdentityClusters, type AccountRow } from '@/lib/duplicateIdentity';

const accounts: AccountRow[] = [
  { user_id: 'u-email', email: 'ajv1005@gmail.com', display_name: '邱郁惠', is_line: false, line_user_id: null, last_sign_in_at: '2026-09-20T13:15:54Z' },
  { user_id: 'u-line', email: 'line_u0796@line.local', display_name: 'Charlene 邱郁惠 🎀', is_line: true, line_user_id: 'u0796884006c10acb328b3c6687bacc1c', last_sign_in_at: '2026-09-20T13:09:25Z' },
];

describe('DuplicateIdentityHint', () => {
  it('顯示提示，點開後列出另一個身分與是否有訂閱', () => {
    const [cluster] = findDuplicateIdentityClusters(accounts, ['u-email']);
    render(<DuplicateIdentityHint cluster={cluster} userId="u-email" />);
    const trigger = screen.getByTestId('duplicate-identity-hint');
    expect(trigger).toHaveTextContent('可能有 2 個帳號');

    fireEvent.click(trigger);
    const others = screen.getByTestId('duplicate-identity-others');
    expect(others).toHaveTextContent('Line 登入');
    expect(others).toHaveTextContent('沒有訂閱');
    expect(screen.getByText(/顯示名稱相同/)).toBeInTheDocument();
  });

  it('群集內只剩自己時不渲染任何提示', () => {
    const cluster = { key: 'k', reasons: [] as never[], members: [{ ...accounts[0], has_subscription: true }] };
    const { container } = render(<DuplicateIdentityHint cluster={cluster} userId="u-email" />);
    expect(container).toBeEmptyDOMElement();
  });
});
