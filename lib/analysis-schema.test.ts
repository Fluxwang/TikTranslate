import { describe, expect, it } from "vitest";

import {
  clampNumber,
  computeDurationLabel,
  computeOverall,
  hasCoreFields,
  normalizeAnalysis,
  normalizeHooks,
  normalizeScores,
  normalizeStringArray,
  normalizeTemplates,
  normalizeVideoStructure,
  parseAnalysis,
  SCORE_DIMS,
} from "./analysis-schema";

describe("parseAnalysis", () => {
  it("解析干净的 JSON", () => {
    expect(parseAnalysis('{"a":1}')).toEqual({ a: 1 });
  });

  it("模型在 JSON 前后加解释文字时仍能抠出对象", () => {
    expect(parseAnalysis('好的，分析结果如下：{"a":1} 希望有帮助')).toEqual({ a: 1 });
  });

  it("模型把 JSON 包在 Markdown 代码块里时仍能解析", () => {
    expect(parseAnalysis('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("完全没有 JSON 时抛错，由调用方走降级", () => {
    expect(() => parseAnalysis("抱歉，我无法完成这个请求")).toThrow("no json object found");
  });
});

describe("hasCoreFields", () => {
  const core = {
    sellingPoints: [],
    scores: [],
    summary: "",
    suggestedQuestions: [],
  };

  it("四个核心字段齐全时通过", () => {
    expect(hasCoreFields(core)).toBe(true);
  });

  it("缺任意一个核心字段就不通过", () => {
    for (const key of Object.keys(core)) {
      expect(hasCoreFields({ ...core, [key]: undefined }), key).toBe(false);
    }
  });

  it("非对象一律不通过", () => {
    expect(hasCoreFields(null)).toBe(false);
    expect(hasCoreFields([])).toBe(false);
    expect(hasCoreFields("{}")).toBe(false);
  });

  it("次要字段缺失不影响判定——它们由 normalize* 补空数组", () => {
    expect(hasCoreFields({ ...core, videoStructure: undefined, hooks: undefined })).toBe(true);
  });
});

describe("normalizeStringArray", () => {
  it("过滤非字符串与空白项，并 trim", () => {
    expect(normalizeStringArray(["  a  ", 1, null, "", "   ", "b"], 5)).toEqual(["a", "b"]);
  });

  it("按 max 截断", () => {
    expect(normalizeStringArray(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  it("非数组返回空数组", () => {
    expect(normalizeStringArray("a", 5)).toEqual([]);
    expect(normalizeStringArray(undefined, 5)).toEqual([]);
  });
});

describe("clampNumber", () => {
  it("把越界值夹到区间内", () => {
    expect(clampNumber(99, 0, 10, 5)).toBe(10);
    expect(clampNumber(-3, 0, 10, 5)).toBe(0);
  });

  it('接受数字字符串——模型经常把分数写成 "8.7"', () => {
    expect(clampNumber("8.7", 0, 10, 5)).toBe(8.7);
  });

  it("无法转成有限数字时返回 fallback", () => {
    expect(clampNumber("abc", 0, 10, 5)).toBe(5);
    expect(clampNumber(null, 0, 10, 5)).toBe(5);
    expect(clampNumber(undefined, 0, 10, 5)).toBe(5);
    expect(clampNumber(Number.NaN, 0, 10, 5)).toBe(5);
    expect(clampNumber(Number.POSITIVE_INFINITY, 0, 10, 5)).toBe(5);
  });
});

describe("computeOverall", () => {
  const score = (val: number) => ({ dim: "d", val, pct: val * 10 });

  it("空数组返回 0 分与最低评级", () => {
    expect(computeOverall([])).toEqual({ score: 0, label: "可参考" });
  });

  it("按均值计算并保留一位小数", () => {
    expect(computeOverall([score(8), score(9)])).toEqual({ score: 8.5, label: "高复制价值" });
  });

  it("评级阈值 8.5 / 7 取闭区间", () => {
    expect(computeOverall([score(8.5)]).label).toBe("高复制价值");
    expect(computeOverall([score(8.4)]).label).toBe("有复制价值");
    expect(computeOverall([score(7)]).label).toBe("有复制价值");
    expect(computeOverall([score(6.9)]).label).toBe("可参考");
  });
});

describe("computeDurationLabel", () => {
  it("覆盖各档位与边界", () => {
    expect(computeDurationLabel(0)).toBe("—");
    expect(computeDurationLabel(60)).toBe("短视频最优区间");
    expect(computeDurationLabel(61)).toBe("中等时长");
    expect(computeDurationLabel(180)).toBe("中等时长");
    expect(computeDurationLabel(181)).toBe("长视频，建议精简");
  });
});

describe("normalizeScores", () => {
  it("无论输入什么，都返回固定 5 维、固定顺序", () => {
    expect(normalizeScores(null, false).map((s) => s.dim)).toEqual(SCORE_DIMS);
    expect(normalizeScores([], false).map((s) => s.dim)).toEqual(SCORE_DIMS);
  });

  it("优先按 dim 名字匹配，与输入顺序无关", () => {
    const result = normalizeScores(
      [
        { dim: "爆款潜力", val: 9, pct: 90 },
        { dim: "说服力", val: 6, pct: 60 },
      ],
      false,
    );
    expect(result[0]).toEqual({ dim: "说服力", val: 6, pct: 60 });
    expect(result[2]).toEqual({ dim: "爆款潜力", val: 9, pct: 90 });
  });

  it("模型改写了维度名时按下标兜底，保住数值", () => {
    const result = normalizeScores([{ dim: "说服力度", val: 7.2, pct: 72 }], false);
    expect(result[0]).toEqual({ dim: "说服力", val: 7.2, pct: 72 });
  });

  it("缺失的维度用其余维度的均值填充，而不是填 0", () => {
    // 只给了两维，均值 (8+6)/2 = 7，剩下三维应当补 7 而不是 0
    const result = normalizeScores(
      [
        { dim: "说服力", val: 8, pct: 80 },
        { dim: "钩子强度", val: 6, pct: 60 },
      ],
      false,
    );
    expect(result[2].val).toBe(7);
    expect(result[4].val).toBe(7);
  });

  it("pct 缺失时由 val 推导", () => {
    expect(normalizeScores([{ dim: "说服力", val: 8.3 }], false)[0].pct).toBe(83);
  });

  it("纯文本模式下把「视觉演示」封顶到 6.5 / 65", () => {
    const raw = [{ dim: "视觉演示", val: 9.8, pct: 98 }];
    expect(normalizeScores(raw, true)[4]).toEqual({ dim: "视觉演示", val: 6.5, pct: 65 });
    // 有视频模式不封顶
    expect(normalizeScores(raw, false)[4]).toEqual({ dim: "视觉演示", val: 9.8, pct: 98 });
  });

  it("封顶只影响视觉演示，不波及其他维度", () => {
    const result = normalizeScores([{ dim: "说服力", val: 9.8, pct: 98 }], true);
    expect(result[0].val).toBe(9.8);
  });

  it("数组里混入非对象项时不崩溃", () => {
    expect(() => normalizeScores(["x", null, 42], false)).not.toThrow();
    expect(normalizeScores(["x", null, 42], false)[0].val).toBe(0);
  });
});

describe("normalizeVideoStructure / normalizeHooks / normalizeTemplates", () => {
  it("非数组一律返回空数组", () => {
    expect(normalizeVideoStructure("x")).toEqual([]);
    expect(normalizeHooks(null)).toEqual([]);
    expect(normalizeTemplates(undefined)).toEqual([]);
  });

  it("videoStructure 丢弃标题与描述皆空的段落，并截断到 6 条", () => {
    expect(normalizeVideoStructure([{ time: "0:00", tags: [] }])).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, desc: "d" }));
    expect(normalizeVideoStructure(many)).toHaveLength(6);
  });

  it("videoStructure 的 tags 最多保留 3 个", () => {
    const [seg] = normalizeVideoStructure([{ title: "t", tags: ["a", "b", "c", "d"] }]);
    expect(seg.tags).toEqual(["a", "b", "c"]);
  });

  it("hooks 丢弃原文与译文皆空的条目，并截断到 6 条", () => {
    expect(normalizeHooks([{ time: "0:00", tag: "钩子" }])).toEqual([]);
    const many = Array.from({ length: 9 }, () => ({ src: "s", zh: "z" }));
    expect(normalizeHooks(many)).toHaveLength(6);
  });

  it("templates 丢弃无正文的条目，并截断到 4 条", () => {
    expect(normalizeTemplates([{ type: "开场模板" }])).toEqual([]);
    const many = Array.from({ length: 9 }, () => ({ type: "t", text: "x" }));
    expect(normalizeTemplates(many)).toHaveLength(4);
  });

  it("字段类型不对时降级成空字符串而不是抛错", () => {
    const [hook] = normalizeHooks([{ time: 12, src: "s", zh: null, tag: {} }]);
    expect(hook).toEqual({ time: "", src: "s", zh: "", tag: "" });
  });
});

describe("normalizeAnalysis", () => {
  const options = {
    durationSec: 45,
    analysisMode: "video_text" as const,
    videoInputMode: "server_tmp_url" as const,
    videoObserved: true,
    videoFallbackReason: null,
  };

  it("输入完全是垃圾时也返回结构完整的结果", () => {
    const result = normalizeAnalysis(null, options);
    expect(result.sellingPoints).toEqual([]);
    expect(result.scores).toHaveLength(5);
    expect(result.summary).toBe("");
    expect(result.videoStructure).toEqual([]);
    expect(result.hooks).toEqual([]);
    expect(result.templates).toEqual([]);
  });

  it("overall 缺失时由 scores 均值兜底", () => {
    const result = normalizeAnalysis(
      { scores: SCORE_DIMS.map((dim) => ({ dim, val: 8, pct: 80 })) },
      options,
    );
    expect(result.overall).toEqual({ score: 8, label: "有复制价值" });
  });

  it("duration.label 缺失时由 durationSec 推导", () => {
    expect(normalizeAnalysis({}, options).duration.label).toBe("短视频最优区间");
    expect(normalizeAnalysis({}, { ...options, durationSec: 200 }).duration.label).toBe(
      "长视频，建议精简",
    );
  });

  it("sellingPoints 截断到 5 条、suggestedQuestions 截断到 3 条", () => {
    const result = normalizeAnalysis(
      {
        sellingPoints: ["1", "2", "3", "4", "5", "6", "7"],
        suggestedQuestions: ["a", "b", "c", "d"],
      },
      options,
    );
    expect(result.sellingPoints).toHaveLength(5);
    expect(result.suggestedQuestions).toHaveLength(3);
  });

  it("meta 由调用方决定，不采信模型自述", () => {
    // 模型声称看到了视频，但调用方传的是 text_only —— 以调用方为准
    const result = normalizeAnalysis(
      { meta: { videoObserved: true, analysisMode: "video_text" } },
      { ...options, analysisMode: "text_only", videoObserved: true },
    );
    expect(result.meta.analysisMode).toBe("text_only");
    expect(result.meta.videoObserved).toBe(false);
  });

  it("text_only 模式下自动对视觉演示封顶", () => {
    const result = normalizeAnalysis(
      { scores: [{ dim: "视觉演示", val: 10, pct: 100 }] },
      { ...options, analysisMode: "text_only" },
    );
    expect(result.scores[4].val).toBe(6.5);
  });
});
