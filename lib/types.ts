// TikTranslate — shared frontend types

// 两个命名相近但含义不同的状态机，注意不要混用：
// Phase 管的是"视频解析 + 字幕识别"这条流程，AnalysisPhase 管的是"AI 分析"这条流程，
// 一个视频进入 recognized 之后才可能触发 AnalysisPhase 从 none 变成 analyzing
export type Phase =
  | "idle"
  | "parsing"
  | "loaded"
  | "recognizing"
  | "recognized";

export type AnalysisPhase = "none" | "analyzing" | "done" | "failed";

export type Subtitle = {
  t: number;
  es: string;
  zh: string;
};

/** Shared 5-color palette used for selling-point pills and score bars. */
export type AccentColor =
  | "purple"
  | "green"
  | "orange"
  | "red"
  | "blue"
  | "pink";

// 卖点文案
export interface SellingPoint {
  text: string; //卖点文案，比如"轻薄"
  color: AccentColor; // 显示用的颜色
}

// 描述Tab里(说服力、钩子强度、爆款潜力等)
export interface ScoreItem {
  dim: string; //维度名称，比如"说服力"、"爆款潜力"、"钩子强度"、"转化引导"、"视觉演示"
  val: number; // 原始分值
  pct: number; // 百分比，用来画进度条宽度
  color: AccentColor; // 进度条颜色
}

// 视频结构Tab里每一段视频叙事拆解的数据结构
export interface VideoStructureSegment {
  title: string;
  time: string;
  desc: string;
  tags: string[];
}

// 爆点话术Tab
export interface HookItem {
  time: string;
  src: string;
  zh: string;
  tag: string;
}

// 达人建议产品模板
export interface ScriptTemplate {
  type: string;
  text: string;
}

export interface AnalysisMeta {
  analysisMode: "video_text" | "text_only";
  videoInputMode: "test_url" | "server_tmp_url" | "none";
  videoObserved: boolean;
  // 这个联合类型和 lib/tmpVideo.ts 里的 VideoFallbackReason 是同一份枚举，
  // 但那边是后端专用模块，这里前端类型没有直接 import，改动需要两处手动同步
  videoFallbackReason:
    | null
    | "no_video_input"
    | "invalid_video_url"
    | "test_video_url_invalid"
    | "public_app_url_missing"
    | "public_app_url_invalid"
    | "video_download_failed"
    | "video_too_large"
    | "tmp_video_url_unavailable"
    | "qwen_video_failed"
    | "qwen_video_json_parse_failed"
    | "qwen_video_not_observed";
}

/** Fully-adapted analysis data consumed by AnalysisPanel. */
// 前端消费的完整版
export interface AnalysisData {
  overall: { score: number; label: string }; //综合评分+评价
  duration: { label: string }; //视频时长描述
  sellingPoints: SellingPoint[]; // 概览Tab的 核心卖点 标签
  scores: ScoreItem[];
  videoStructure: VideoStructureSegment[];
  hooks: HookItem[];
  templates: ScriptTemplate[];
  summary: string;
  suggestedQuestions: string[];
}

/** Raw shape currently returned by /api/analyze. */
// 后端/api/analyze 实际返回的粗糙版
export interface AnalyzeResponse {
  sellingPoints: string[];
  scores: { dim: string; val: number; pct: number }[];
  summary: string;
  suggestedQuestions: string[];
  // Not yet returned by the backend — see docs/aiAnalysis-backend-todo.md
  overall?: { score: number; label: string };
  duration?: { label: string };
  videoStructure?: VideoStructureSegment[];
  hooks?: HookItem[];
  templates?: ScriptTemplate[];
  meta?: AnalysisMeta;
}

export interface Product {
  id: string;
  name: string;
  audience: string;
  sellingPoints: string;
  scene: string;
}

// 和 AnalysisData 字段很像但不是一回事：这里没有 overall/duration/scores，
// sellingPoints 也是纯字符串数组而非 SellingPoint[]——专门给"达人建议"生成接口用的精简结构
export interface SuggestAnalysis {
  hooks: HookItem[];
  videoStructure: VideoStructureSegment[];
  templates: ScriptTemplate[];
  sellingPoints: string[];
  summary: string;
}

// 达人建议返回中，西，英
export interface SuggestResponse {
  en: string;
  es: string;
  zh: string;
}
