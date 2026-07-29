import { describe, expect, it } from "vitest";

import { adaptAnalysis, DEFAULT_PRODUCTS, EMPTY_ANALYSIS, loadProducts } from "./analysis";
import type { AnalyzeResponse } from "./types";

/** 只填必需字段的最小 AnalyzeResponse，其余字段各用例按需覆盖。 */
function raw(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    sellingPoints: [],
    scores: [],
    summary: "",
    suggestedQuestions: [],
    ...overrides,
  } as AnalyzeResponse;
}

describe("adaptAnalysis", () => {
  it("给卖点按 5 色调色板循环上色", () => {
    const result = adaptAnalysis(raw({ sellingPoints: ["a", "b", "c", "d", "e", "f"] }), 30);
    expect(result.sellingPoints.map((s) => s.color)).toEqual([
      "purple",
      "green",
      "orange",
      "red",
      "blue",
      "purple", // 第 6 个回到起点
    ]);
    expect(result.sellingPoints.map((s) => s.text)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("给评分按另一套调色板上色并保留原字段", () => {
    const result = adaptAnalysis(
      raw({
        scores: [
          { dim: "说服力", val: 8, pct: 80 },
          { dim: "钩子强度", val: 9, pct: 90 },
        ],
      }),
      30,
    );
    expect(result.scores[0]).toEqual({ dim: "说服力", val: 8, pct: 80, color: "purple" });
    expect(result.scores[1].color).toBe("green");
  });

  it("后端已给出 overall 时直接采用", () => {
    const result = adaptAnalysis(raw({ overall: { score: 9.9, label: "自定义评级" } }), 30);
    expect(result.overall).toEqual({ score: 9.9, label: "自定义评级" });
  });

  it("overall 缺失时由 scores 均值兜底", () => {
    const result = adaptAnalysis(
      raw({
        scores: [
          { dim: "a", val: 9, pct: 90 },
          { dim: "b", val: 8, pct: 80 },
        ],
      }),
      30,
    );
    expect(result.overall).toEqual({ score: 8.5, label: "高复制价值" });
  });

  it("scores 为空时 overall 兜底成 0 分与破折号", () => {
    expect(adaptAnalysis(raw(), 30).overall).toEqual({ score: 0, label: "—" });
  });

  it("duration 缺失时由 durationSec 推导", () => {
    expect(adaptAnalysis(raw(), 45).duration.label).toBe("短视频最优区间");
    expect(adaptAnalysis(raw(), 200).duration.label).toBe("长视频，建议精简");
    expect(adaptAnalysis(raw(), 0).duration.label).toBe("—");
  });

  it("后端尚未实现的字段缺失时补空数组，前端不必判空", () => {
    const result = adaptAnalysis(raw(), 30);
    expect(result.videoStructure).toEqual([]);
    expect(result.hooks).toEqual([]);
    expect(result.templates).toEqual([]);
    expect(result.summary).toBe("");
    expect(result.suggestedQuestions).toEqual([]);
  });
});

describe("EMPTY_ANALYSIS", () => {
  it("形状与 adaptAnalysis 对空输入的结果一致", () => {
    // 两者必须同构，否则「加载中」和「分析完但没内容」两种状态会渲染出不同的骨架
    expect(Object.keys(EMPTY_ANALYSIS).sort()).toEqual(Object.keys(adaptAnalysis(raw(), 0)).sort());
  });
});

describe("loadProducts", () => {
  it("服务端渲染（无 window）时返回默认产品而不是抛错", () => {
    expect(loadProducts()).toEqual(DEFAULT_PRODUCTS);
  });
});
