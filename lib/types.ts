// TikTranslate — shared frontend types

export type Phase = 'idle' | 'parsing' | 'loaded' | 'recognizing' | 'recognized';
export type AnalysisPhase = 'none' | 'analyzing' | 'done' | 'failed';

export type Subtitle = {
  t: number;
  es: string;
  zh: string;
};

/** Shared 5-color palette used for selling-point pills and score bars. */
export type AccentColor = 'purple' | 'green' | 'orange' | 'red' | 'blue' | 'pink';

export interface SellingPoint {
  text: string;
  color: AccentColor;
}

export interface ScoreItem {
  dim: string;
  val: number;
  pct: number;
  color: AccentColor;
}

export interface VideoStructureSegment {
  title: string;
  time: string;
  desc: string;
  tags: string[];
}

export interface HookItem {
  time: string;
  src: string;
  zh: string;
  tag: string;
}

export interface ScriptTemplate {
  type: string;
  text: string;
}

/** Fully-adapted analysis data consumed by AnalysisPanel. */
export interface AnalysisData {
  overall: { score: number; label: string };
  duration: { label: string };
  sellingPoints: SellingPoint[];
  scores: ScoreItem[];
  videoStructure: VideoStructureSegment[];
  hooks: HookItem[];
  templates: ScriptTemplate[];
  summary: string;
  suggestedQuestions: string[];
}

/** Raw shape currently returned by /api/analyze. */
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
}

export interface Product {
  id: string;
  name: string;
  audience: string;
  sellingPoints: string;
  scene: string;
}
