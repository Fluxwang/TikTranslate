import { Icon } from "../shared/Icon";
import { EmptyTab } from "../shared/Placeholders";
import type { AnalysisData } from "@/lib/types";

/** 视频结构 Tab：AI 对视频叙事的分段拆解。 */
export function StructureTab({ data }: { data: AnalysisData }) {
  if (data.videoStructure.length === 0) {
    return (
      <EmptyTab
        title="暂无视频结构数据"
        description="该卡片展示 AI 对视频叙事结构的分段拆解，需后端在分析结果中返回 videoStructure 字段，详见集成文档。"
      />
    );
  }

  return (
    <div className="ai-body">
      <div className="sec-title">
        <Icon name="list" size={15} /> 视频叙事结构拆解
      </div>
      <div className="struct-list">
        {data.videoStructure.map((segment, i) => (
          <div className="struct-item" key={i}>
            <div className="struct-num">{i + 1}</div>
            <div className="struct-body">
              <div className="struct-head">
                <span className="ttl">{segment.title}</span>
                <span className="ts">{segment.time}</span>
              </div>
              <p className="desc">{segment.desc}</p>
              <div className="struct-tags">
                {segment.tags.map((tag, j) => (
                  <span className="t" key={j}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
