// /api/analyze 的 prompt 构造层。
//
// 单独成文件的理由：这段 prompt 的措辞（字段数量要求、维度顺序、防幻觉规则）
// 是反复调优出来的，改动它的风险和改代码不同——不会编译报错，只会让
// lib/analysis-schema.ts 的 normalize* 静默拿到不符合预期的结构。
// 放在独立文件里，改动一眼可见，也便于 diff 时聚焦。

import type { Subtitle } from "./types";

export type MessageContent =
  | string
  | Array<
      | {
          type: "video_url";
          video_url: { url: string };
          fps: number;
        }
      | {
          type: "text";
          text: string;
        }
    >;

/** 秒 → `m:ss`。非法输入一律按 0 处理，保证 prompt 里不会出现 NaN。 */
export function formatTime(seconds: unknown) {
  const value = typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

/** 把字幕数组拼成「[时间] 原文 / 中文」的逐行文本，喂给模型。 */
export function buildTranscript(subtitles: Subtitle[]) {
  return subtitles.map((s) => `[${formatTime(s.t)}] ${s.es} / ${s.zh}`).join("\n");
}

// 改动前先想清楚会不会影响 LLM 输出结构，避免 lib/analysis-schema.ts 的
// normalize* 函数拿到无法解析的内容
export function buildPrompt(options: {
  transcript: string;
  durationSec: number;
  hasVideo: boolean;
}) {
  const modeInstruction = options.hasVideo
    ? "你收到了视频和字幕。必须结合画面、镜头、产品出现方式、视觉演示和字幕话术分析，不要只分析字幕。"
    : "你没有收到可用视频。必须基于字幕时间轴完成分析，不能声称看到了画面；视觉演示评分应保守。";

  return `用户是国内电商从业者，目标是拆解海外 TikTok 带货视频。
${modeInstruction}

字幕格式为「时间 原文 / 中文翻译」。
视频时长参考：${options.durationSec > 0 ? `${Math.round(options.durationSec)} 秒` : "未知"}。

字幕：
${options.transcript}

请只输出 JSON，不要输出 Markdown、解释或代码块。JSON 必须符合以下结构和要求：
{
  "overall": { "score": 8.7, "label": "高复制价值" },
  "duration": { "label": "短视频最优区间" },
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "scores": [
    { "dim": "说服力", "val": 8.7, "pct": 87 },
    { "dim": "钩子强度", "val": 9.2, "pct": 92 },
    { "dim": "爆款潜力", "val": 8.1, "pct": 81 },
    { "dim": "转化引导", "val": 8.8, "pct": 88 },
    { "dim": "视觉演示", "val": 9.0, "pct": 90 }
  ],
  "videoStructure": [
    { "title": "强钩子开场", "time": "0:00-0:05", "desc": "画面/话术做了什么，以及为什么有效。", "tags": ["好奇心缺口", "结果前置"] }
  ],
  "hooks": [
    { "time": "0:00", "src": "原语言字幕或视频话术", "zh": "中文翻译", "tag": "⚡ 开场钩子 - 好奇心缺口" }
  ],
  "templates": [
    { "type": "开场模板", "text": "说真的，自从用了 [产品]，我家就再也没 [旧的麻烦做法] 过了。" }
  ],
  "summary": "100-200 字中文摘要。",
  "suggestedQuestions": ["追问1", "追问2", "追问3"],
  "meta": {
    "analysisMode": "${options.hasVideo ? "video_text" : "text_only"}",
    "videoInputMode": "${options.hasVideo ? "server_tmp_url" : "none"}",
    "videoObserved": ${options.hasVideo ? "true" : "false"},
    "videoFallbackReason": null
  }
}

字段数量要求：
- sellingPoints 返回 3-5 条。
- scores 固定返回 5 维，顺序必须是：说服力、钩子强度、爆款潜力、转化引导、视觉演示。
- videoStructure 返回 4-6 段，覆盖完整时间线；desc 必须说明画面/话术做了什么以及为什么有效。
- hooks 返回 4-6 条，按时间顺序；src 必须来自原语言字幕或视频话术，不要编造；zh 必须是中文翻译。
- templates 返回 4 条，覆盖开场、演示、结果、收口；text 用 [方括号] 标注可替换槽位。
- suggestedQuestions 返回 3 条。
- 如果你能基于视频画面进行观察，meta.videoObserved 返回 true。
- 如果没有收到视频、无法读取视频、只能基于字幕分析，meta.videoObserved 返回 false。
- 不确定是否看到了视频时，meta.videoObserved 返回 false。
- 如果视频不可见但有字幕，仍然完成结构化分析，并降低“视觉演示”评分。
- text-only 模式下 videoStructure 必须基于字幕时间轴描述，不能声称看到画面。`;
}

/**
 * 组装 chat/completions 的 messages。
 *
 * 有视频时用多模态 content 数组，没有时退化成纯字符串——两种形状都是
 * OpenAI 兼容接口允许的，但不能给纯文本请求塞一个只有 text 项的数组，
 * 部分兼容实现会因此拒绝请求。
 */
export function buildMessages(
  prompt: string,
  videoUrl: string | null,
): { role: string; content: MessageContent }[] {
  const system = {
    role: "system",
    content: "你是一位专业的 TikTok 带货视频分析师，只输出 JSON。",
  };

  if (!videoUrl) {
    return [system, { role: "user", content: prompt }];
  }

  return [
    system,
    {
      role: "user",
      content: [
        {
          type: "video_url",
          video_url: { url: videoUrl },
          fps: 2, // 抽帧频率：每秒取 2 帧喂给模型，不是逐帧分析
        },
        {
          type: "text",
          text: prompt,
        },
      ],
    },
  ];
}
