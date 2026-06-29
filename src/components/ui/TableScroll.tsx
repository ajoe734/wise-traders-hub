import { ReactNode } from "react";

/**
 * 表格水平捲動包裹元件。
 * 在窄螢幕避免表格內容溢出造成整頁橫向 scroll。
 *
 * 用法：
 *   <TableScroll>
 *     <table className="w-full ...">...</table>
 *   </TableScroll>
 */
export function TableScroll({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto -mx-2 px-2 ${className}`.trim()}>
      {children}
    </div>
  );
}

export default TableScroll;
