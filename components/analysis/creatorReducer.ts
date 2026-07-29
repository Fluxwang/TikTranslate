import type { SuggestResponse } from "@/lib/types";

export type CreatorLang = "en" | "es" | "zh";

export type CreatorState = {
  productId: string;
  loading: boolean;
  results: SuggestResponse | null;
  lang: CreatorLang;
  error: boolean;
  copied: boolean;
};

export type CreatorAction =
  | { type: "selectProduct"; productId: string }
  | { type: "startGenerate" }
  | { type: "generateSuccess"; results: SuggestResponse }
  | { type: "generateError" }
  | { type: "setLang"; lang: CreatorLang }
  | { type: "copied" }
  | { type: "resetCopied" };

/**
 * 达人建议 Tab 的状态机。
 *
 * 这里用 useReducer 而不是六个 useState，是因为这些字段之间有**联动规则**：
 * 开始生成要同时清掉上一轮的结果、错误和「已复制」；切换语言要清掉「已复制」。
 * 拆成独立 useState 的话，这些规则会散落在每个事件处理器里，
 * 漏掉一处就会出现「显示已复制，但内容已经换成另一种语言」这类不一致状态。
 * 收进 reducer 后，规则和状态定义在同一处，读一遍就能确认覆盖完整。
 */
export function creatorReducer(state: CreatorState, action: CreatorAction): CreatorState {
  switch (action.type) {
    case "selectProduct":
      return { ...state, productId: action.productId };
    // 清空上一轮的结果/错误/复制状态，避免新结果出来前旧内容闪一下
    case "startGenerate":
      return { ...state, loading: true, results: null, error: false, copied: false };
    case "generateSuccess":
      return { ...state, loading: false, results: action.results, error: false };
    case "generateError":
      return { ...state, loading: false, results: null, error: true, copied: false };
    // 复制的是切换前那个语言的内容，切换后「已复制」就不再成立
    case "setLang":
      return { ...state, lang: action.lang, copied: false };
    case "copied":
      return { ...state, copied: true };
    case "resetCopied":
      return { ...state, copied: false };
  }
}

export function createCreatorState(productId: string): CreatorState {
  return {
    productId,
    loading: false,
    results: null,
    lang: "en",
    error: false,
    copied: false,
  };
}
