"use client";

import { useEffect, useReducer, useRef } from "react";

import { createCreatorState, creatorReducer } from "../creatorReducer";
import { Icon } from "../shared/Icon";
import { Markdown } from "../shared/Markdown";
import { CardSkeleton } from "../shared/Placeholders";
import { stripMarkdown } from "@/lib/format";
import type {
  AnalysisData,
  AnalysisPhase,
  Product,
  SuggestAnalysis,
  SuggestResponse,
} from "@/lib/types";

/** 「已复制」提示的持续时间（毫秒）。 */
const COPIED_HINT_MS = 2000;

const LANGS = ["en", "es", "zh"] as const;

/**
 * 达人建议 Tab：把视频分析结果 + 选中的产品交给 AI，生成可直接发给达人的文案。
 *
 * 状态联动规则集中在 creatorReducer 里，这个组件只负责触发动作与渲染。
 */
export function CreatorTab({
  data,
  analysisPhase,
  products,
  onSuggest,
}: {
  data: AnalysisData;
  analysisPhase: AnalysisPhase;
  products: Product[];
  onSuggest: (product: Product, analysis: SuggestAnalysis) => Promise<SuggestResponse>;
}) {
  // useReducer 的第三个参数是惰性初始化：第二个参数先传给它，由它算出初始 state。
  // 这样初始对象只在挂载时构造一次，而不是每次渲染都新建一个再丢掉。
  const [state, dispatch] = useReducer(creatorReducer, products[0]?.id ?? "", createCreatorState);

  const copyTimerRef = useRef<number | null>(null);

  // 卸载时清掉「已复制」的定时器，否则它会在已卸载的组件上 dispatch
  useEffect(() => {
    return () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  // 设置页删掉了当前选中的产品时回退到第一个
  const product = products.find((item) => item.id === state.productId) ?? products[0];
  const canGenerate = analysisPhase === "done";
  const currentResult = state.results?.[state.lang] ?? "";

  const handleGenerate = async () => {
    if (!product || state.loading || !canGenerate) return;

    dispatch({ type: "startGenerate" });
    try {
      const results = await onSuggest(product, {
        hooks: data.hooks,
        videoStructure: data.videoStructure,
        templates: data.templates,
        sellingPoints: data.sellingPoints.map((point) => point.text),
        summary: data.summary,
      });
      dispatch({ type: "generateSuccess", results });
    } catch {
      dispatch({ type: "generateError" });
    }
  };

  const handleCopy = () => {
    if (!currentResult) return;

    const markCopied = () => {
      dispatch({ type: "copied" });
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(
        () => dispatch({ type: "resetCopied" }),
        COPIED_HINT_MS,
      );
    };

    if (navigator.clipboard?.writeText) {
      // 成功和失败用同一个回调（.then(markCopied, markCopied)）：即使浏览器因
      // 权限或非安全上下文静默拒绝了写入，UI 上也会显示「已复制」。
      // 这是刻意的简化——区分出来也只能提示用户手动复制，收益不大。
      navigator.clipboard.writeText(stripMarkdown(currentResult)).then(markCopied, markCopied);
    } else {
      markCopied();
    }
  };

  if (!product) return null;

  return (
    <div className="ai-body creator-body">
      {/* 固定在顶部的控件区 */}
      <div className="creator-controls">
        <div className="gen-label">Select product</div>
        <select
          className="gen-select"
          value={product.id}
          onChange={(event) => dispatch({ type: "selectProduct", productId: event.target.value })}
        >
          {products.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="gen-btn"
          disabled={state.loading || !canGenerate}
          onClick={handleGenerate}
          title={canGenerate ? undefined : "请先完成视频分析"}
        >
          {state.loading ? (
            <>
              <span className="spinner" /> Generating...
            </>
          ) : (
            "Generate creator suggestion"
          )}
        </button>
      </div>

      {/* 可滚动的结果区 */}
      <div className="creator-result">
        {state.loading && !state.results && (
          <div className="gen-result">
            <div className="gen-body">
              <CardSkeleton lines={5} />
            </div>
          </div>
        )}

        {state.error && (
          <div className="gen-error">
            <Icon name="alertCircle" size={15} /> 生成失败，请重试
          </div>
        )}

        {state.results && (
          <div className="gen-result">
            <div className="bar">
              <span className="ready">
                <span className="dot" /> Ready to send
              </span>
              <div className="lang-pills">
                {LANGS.map((lang) => (
                  <button
                    type="button"
                    key={lang}
                    className={`lang-pill${state.lang === lang ? " on" : ""}`}
                    onClick={() => dispatch({ type: "setLang", lang })}
                  >
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`copy-btn${state.copied ? " copied" : ""}`}
                onClick={handleCopy}
              >
                {state.copied ? (
                  <>
                    <Icon name="check" size={13} /> Copied
                  </>
                ) : (
                  <>
                    <Icon name="copy" size={13} /> Copy
                  </>
                )}
              </button>
            </div>
            <div className="gen-body">
              <Markdown>{currentResult}</Markdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
