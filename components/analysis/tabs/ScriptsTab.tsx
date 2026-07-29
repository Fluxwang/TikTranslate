import { Icon } from "../shared/Icon";
import { EmptyTab } from "../shared/Placeholders";
import type { AnalysisData } from "@/lib/types";

/**
 * 把话术模板里的 `[方括号槽位]` 高亮出来。
 *
 * 用**带捕获组**的正则做 split：分隔符本身会被保留在结果数组里
 * （不带捕获组的话槽位会被直接丢掉），这样才能把槽位单独包一层 <span>
 * 而其余文本原样保留。
 */
function renderSlots(text: string) {
  return text.split(/(\[[^\]]+\])/g).map((part, i) =>
    /^\[[^\]]+\]$/.test(part) ? (
      <span className="slot" key={i}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** 爆点话术 Tab：高效钩子提取 + 可复用话术模板。 */
export function ScriptsTab({ data }: { data: AnalysisData }) {
  if (data.hooks.length === 0 && data.templates.length === 0) {
    return (
      <EmptyTab
        title="暂无爆点话术数据"
        description="该 Tab 展示高效钩子提取与可复用话术模板，需后端在分析结果中返回 hooks 和 templates 字段，详见集成文档。"
      />
    );
  }

  return (
    <div className="ai-body">
      {data.hooks.length > 0 && (
        <div className="sec">
          <div className="sec-title">
            <Icon name="bolt" size={15} /> 高效钩子话术提取
          </div>
          <div className="hook-list">
            {data.hooks.map((hook, i) => (
              <div className="hook-card" key={i}>
                <div className="ts">{hook.time}</div>
                <div className="src">{hook.src}</div>
                <div className="zh">{hook.zh}</div>
                <span className="hook-tag">{hook.tag}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.templates.length > 0 && (
        <div className="sec">
          <div className="sec-title">
            <Icon name="messages" size={15} /> 可复用话术模板
          </div>
          <div className="tpl-list">
            {data.templates.map((template, i) => (
              <div className="tpl-card" key={i}>
                <span className="type">{template.type}</span>
                <div className="body">{renderSlots(template.text)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
