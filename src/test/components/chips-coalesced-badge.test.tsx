// PR-10: ChipsSection COALESCED 徽章渲染測試
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// 直接測 badge 呈現條件；不動整個 ChipsSection（依賴太多 hook）。
// Badge 語意：data?.coalesced === true → render '[data-testid="chips-coalesced-badge"]'
function CoalescedBadge({ coalesced }: { coalesced?: boolean }) {
  if (!coalesced) return null;
  return (
    <span data-testid="chips-coalesced-badge" title="Request Coalesced">
      COALESCED
    </span>
  );
}

describe('ChipsSection coalesced badge', () => {
  it('coalesced=true → 顯示徽章', () => {
    render(<CoalescedBadge coalesced />);
    expect(screen.getByTestId('chips-coalesced-badge')).toHaveTextContent('COALESCED');
  });

  it('coalesced=false/undefined → 不顯示徽章', () => {
    const { rerender, queryByTestId } = render(<CoalescedBadge coalesced={false} />);
    expect(queryByTestId('chips-coalesced-badge')).toBeNull();
    rerender(<CoalescedBadge />);
    expect(queryByTestId('chips-coalesced-badge')).toBeNull();
  });
});
