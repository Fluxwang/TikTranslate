import { Icon } from "./Icon";

/**
 * 骨架屏。
 *
 * 每行宽度递减（95% / 81% / 67%…）而不是等宽：等宽的灰条看起来像加载失败的
 * 表格，递减的形状更接近真实段落，用户一眼就知道这里将来会是文字。
 */
export function CardSkeleton({ lines }: { lines: number }) {
  return (
    <div>
      {Array.from({ length: lines }).map((_, i) => (
        <div className="sk-block" key={i} style={{ width: `${95 - i * 14}%` }} />
      ))}
    </div>
  );
}

/** Tab 内容加载中的整体骨架。 */
export function LoadingTab() {
  return (
    <div className="ai-body">
      <CardSkeleton lines={3} />
      <div style={{ height: 8 }} />
      <CardSkeleton lines={4} />
    </div>
  );
}

/** Tab 无数据时的占位。description 说明缺什么、为什么缺。 */
export function EmptyTab({ title, description }: { title: string; description: string }) {
  return (
    <div className="ai-body">
      <div className="empty">
        <div className="ei">
          <Icon name="info" size={18} />
        </div>
        <div className="et">{title}</div>
        <div className="es">{description}</div>
      </div>
    </div>
  );
}
