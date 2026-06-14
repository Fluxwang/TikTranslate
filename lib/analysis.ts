// TikTranslate — AI 分析数据适配 + 产品设置
// 把 /api/analyze 的现有返回值适配成 AnalysisPanel 需要的完整结构，
// 缺失的字段（overall/duration.label/videoStructure/hooks/templates）用占位逻辑填充。
// 详见 docs/aiAnalysis-backend-todo.md。

import type { AccentColor, AnalysisData, AnalyzeResponse, Product, ScoreItem, SellingPoint } from './types';

const SELLING_POINT_COLORS: AccentColor[] = ['purple', 'green', 'orange', 'red', 'blue'];
const SCORE_COLORS: AccentColor[] = ['purple', 'green', 'orange', 'pink', 'blue'];

export const EMPTY_ANALYSIS: AnalysisData = {
  overall: { score: 0, label: '' },
  duration: { label: '' },
  sellingPoints: [],
  scores: [],
  videoStructure: [],
  hooks: [],
  templates: [],
  summary: '',
  suggestedQuestions: [],
};

function computeOverall(scores: ScoreItem[]): { score: number; label: string } {
  if (scores.length === 0) return { score: 0, label: '—' };
  const avg = scores.reduce((sum, s) => sum + s.val, 0) / scores.length;
  const score = Math.round(avg * 10) / 10;
  const label = score >= 8.5 ? '高复制价值' : score >= 7 ? '有复制价值' : '可参考';
  return { score, label };
}

function computeDurationLabel(durationSec: number): string {
  if (!durationSec) return '—';
  if (durationSec <= 60) return '短视频最优区间';
  if (durationSec <= 180) return '中等时长';
  return '长视频，建议精简';
}

/** 把后端 /api/analyze 的返回值适配为 AnalysisPanel 所需的完整数据结构。 */
export function adaptAnalysis(raw: AnalyzeResponse, durationSec: number): AnalysisData {
  const sellingPoints: SellingPoint[] = (raw.sellingPoints ?? []).map((text, i) => ({
    text,
    color: SELLING_POINT_COLORS[i % SELLING_POINT_COLORS.length],
  }));

  const scores: ScoreItem[] = (raw.scores ?? []).map((s, i) => ({
    ...s,
    color: SCORE_COLORS[i % SCORE_COLORS.length],
  }));

  return {
    overall: raw.overall ?? computeOverall(scores),
    duration: raw.duration ?? { label: computeDurationLabel(durationSec) },
    sellingPoints,
    scores,
    videoStructure: raw.videoStructure ?? [],
    hooks: raw.hooks ?? [],
    templates: raw.templates ?? [],
    summary: raw.summary ?? '',
    suggestedQuestions: raw.suggestedQuestions ?? [],
  };
}

/* ---------------------------------------------------------------------- */
/* 产品设置（暂存 localStorage，后续接后端存储）                              */
/* ---------------------------------------------------------------------- */

const PRODUCTS_STORAGE_KEY = 'tt_products';

export const DEFAULT_PRODUCTS: Product[] = [
  {
    id: 'p1',
    name: 'Automatic Cat Litter Box',
    audience: 'Cat owners with large cats or multiple cats',
    sellingPoints:
      '106L interior space, fits cats up to 25lbs, app control, auto-clean, safety sensors, quiet motor',
    scene: 'Daily cat care, multi-cat households, busy pet owners',
  },
  {
    id: 'p2',
    name: 'Industrial Evaporative Cooler',
    audience: 'Outdoor enthusiasts, families with backyard, no AC households',
    sellingPoints: 'No AC needed, works outdoors, whisper-quiet, covers large area, energy efficient',
    scene: 'BBQ, backyard hangout, garage, patio, summer outdoor activities',
  },
];

export function loadProducts(): Product[] {
  if (typeof window === 'undefined') return DEFAULT_PRODUCTS;
  try {
    const raw = window.localStorage.getItem(PRODUCTS_STORAGE_KEY);
    if (!raw) return DEFAULT_PRODUCTS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Product[];
  } catch {
    // ignore malformed storage
  }
  return DEFAULT_PRODUCTS;
}

export function saveProducts(products: Product[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(products));
}
