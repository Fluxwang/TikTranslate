import { Icon } from "../shared/Icon";
import { CardSkeleton } from "../shared/Placeholders";
import { formatTime } from "@/lib/format";
import type { AnalysisData } from "@/lib/types";

/**
 * 概览 Tab：综合评分、时长、核心卖点、内容评分。
 *
 * 这是唯一一个在分析尚未完成时也渲染真实内容的 Tab——它按 step 分级点亮：
 * step >= 1 出卖点，step >= 2 出评分。其余 Tab 是「要么骨架屏、要么全部内容」。
 * 这么做是因为概览是默认选中的 Tab，全程骨架屏会让人以为卡住了。
 */
export function OverviewTab({
  data,
  durationSec,
  step,
}: {
  data: AnalysisData;
  durationSec: number;
  step: number;
}) {
  return (
    <div className="ai-body">
      <div className="stat-grid">
        <div className="stat-card enter">
          <div className="cap">综合爆款评分</div>
          <div className="big accent">{step >= 2 ? data.overall.score.toFixed(1) : "—"}</div>
          {/* 空格而不是空字符串：占住行高，数值出现时布局不会跳 */}
          <div className="sub">{step >= 2 ? data.overall.label : " "}</div>
        </div>
        <div className="stat-card enter">
          <div className="cap">视频时长</div>
          <div className="big">{formatTime(durationSec)}</div>
          <div className="sub">{data.duration.label || " "}</div>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">
          <Icon name="tag" size={15} /> 核心卖点
        </div>
        {step >= 1 ? (
          <div className="tag-group">
            {data.sellingPoints.map((point, i) => (
              <span className={`pill-c c-${point.color}`} key={i}>
                {point.text}
              </span>
            ))}
          </div>
        ) : (
          <CardSkeleton lines={2} />
        )}
      </div>

      <div className="sec">
        <div className="sec-title">
          <Icon name="chartBar" size={15} /> 内容评分
        </div>
        {step >= 2 ? (
          <div>
            {data.scores.map((score, i) => (
              <div className={`score-row c-${score.color}`} key={i}>
                <span className="dim">{score.dim}</span>
                <div className="score-bar">
                  <div className="fill c" style={{ width: `${score.pct}%` }} />
                </div>
                <span className="val">{score.val.toFixed(1)}</span>
              </div>
            ))}
          </div>
        ) : (
          <CardSkeleton lines={4} />
        )}
      </div>
    </div>
  );
}
