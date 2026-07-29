"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import { SettingsPage } from "./settings/SettingsPage";
import { Icon } from "./shared/Icon";
import { LoadingTab } from "./shared/Placeholders";
import { AskTab } from "./tabs/AskTab";
import { CreatorTab } from "./tabs/CreatorTab";
import { OverviewTab } from "./tabs/OverviewTab";
import { ScriptsTab } from "./tabs/ScriptsTab";
import { StructureTab } from "./tabs/StructureTab";
import type { ChatTurn } from "@/hooks/useChat";
import type {
  AnalysisData,
  AnalysisPhase,
  Phase,
  Product,
  SuggestAnalysis,
  SuggestResponse,
} from "@/lib/types";

const AI_TABS = [
  { id: "overview", label: "概览" },
  { id: "structure", label: "视频结构" },
  { id: "scripts", label: "爆点话术" },
  { id: "creator", label: "达人建议" },
  { id: "ask", label: "追问 AI" },
] as const;

// 从 AI_TABS 数组反推联合类型，而不是另外再写一遍 "overview" | "structure" | ...
// 增删 tab 时类型自动跟着变，不会出现两处不同步
type TabId = (typeof AI_TABS)[number]["id"];

interface Props {
  phase: Phase;
  analysisPhase: AnalysisPhase;
  analysisStep: number;
  analysisError: string;
  data: AnalysisData;
  durationSec: number;
  products: Product[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  thread: ChatTurn[];
  onSend: (question: string) => void;
  onSuggest: (product: Product, analysis: SuggestAnalysis) => Promise<SuggestResponse>;
  askPending: boolean;
  onStartAnalysis: () => void;
}

/** 顶部右上角随分析阶段变化的状态指示。 */
function StatusAction({
  phase,
  analysisPhase,
  onStartAnalysis,
}: {
  phase: Phase;
  analysisPhase: AnalysisPhase;
  onStartAnalysis: () => void;
}) {
  const compactButton = { height: 26, padding: "0 10px", fontSize: 11 } as const;

  if (analysisPhase === "none") {
    return (
      <button
        className="btn btn-ghost"
        style={compactButton}
        disabled={phase !== "recognized"}
        onClick={onStartAnalysis}
      >
        {phase === "recognized" ? "开始分析" : "等待字幕"}
      </button>
    );
  }

  if (analysisPhase === "analyzing") {
    return (
      <button className="btn btn-ghost" style={compactButton} disabled>
        <span className="spinner" /> 分析中
      </button>
    );
  }

  if (analysisPhase === "failed") {
    return (
      <span className="beta" style={{ textTransform: "none" }}>
        失败
      </span>
    );
  }

  return (
    <span className="beta" style={{ textTransform: "none", whiteSpace: "nowrap" }}>
      <Icon name="check" size={11} /> 已完成
    </span>
  );
}

/**
 * 右侧 AI 分析栏：5 个 Tab + 产品设置页。
 *
 * 这个组件只做三件事：按 analysisPhase 决定渲染空态 / 失败态 / Tab 区，
 * 维护当前 Tab，以及把 props 分发给各 Tab。每个 Tab 的内容与状态都在
 * 自己的文件里，改一个 Tab 不需要读其他任何一个。
 */
export default function AnalysisPanel({
  phase,
  analysisPhase,
  analysisStep,
  analysisError,
  data,
  durationSec,
  products,
  setProducts,
  thread,
  onSend,
  onSuggest,
  askPending,
  onStartAnalysis,
}: Props) {
  const [tab, setTab] = useState<TabId>("overview");
  const [showSettings, setShowSettings] = useState(false);

  const started = analysisPhase !== "none";
  const done = analysisPhase === "done";

  if (showSettings) {
    return (
      <section className="col">
        <SettingsPage
          products={products}
          setProducts={setProducts}
          onClose={() => setShowSettings(false)}
        />
      </section>
    );
  }

  return (
    <section className="col">
      <div className="col-head">
        <span className="label">
          <Icon name="sparkles" /> AI 分析
        </span>
        <div className="actions">
          <StatusAction
            phase={phase}
            analysisPhase={analysisPhase}
            onStartAnalysis={onStartAnalysis}
          />
          <button
            type="button"
            className="icon-btn gear"
            title="产品设置"
            onClick={() => setShowSettings(true)}
          >
            <Icon name="settings" size={15} />
          </button>
        </div>
      </div>

      {!started ? (
        <div className="empty">
          <div className="ei">
            <Icon name="sparkles" size={18} />
          </div>
          <div className="et">{phase === "recognized" ? "字幕已就绪" : "等待字幕识别完成"}</div>
          <div className="es">
            {phase === "recognized"
              ? "点击「开始分析」提取卖点、拆解视频结构并生成达人建议。"
              : "识别完成后即可对达人话术进行结构、评分与话术分析。"}
          </div>
        </div>
      ) : analysisPhase === "failed" ? (
        <div className="empty">
          <div className="ei">
            <Icon name="alertCircle" size={18} />
          </div>
          <div className="et">分析失败</div>
          <div className="es">
            {analysisError || "请检查 ANALYSIS_BASE_URL、ANALYSIS_API_KEY 和模型配置。"}
          </div>
        </div>
      ) : (
        <>
          <div className="ai-tabnav">
            {AI_TABS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`tab${tab === item.id ? " on" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <OverviewTab data={data} durationSec={durationSec} step={analysisStep} />
          )}
          {tab === "structure" && (done ? <StructureTab data={data} /> : <LoadingTab />)}
          {tab === "scripts" && (done ? <ScriptsTab data={data} /> : <LoadingTab />)}
          {/* 达人建议 Tab 不等 done 就渲染真实内容——它内部用 canGenerate
              控制生成按钮是否可点，这样用户能提前切过来选好产品，
              分析一完成就能立刻点生成 */}
          {tab === "creator" && (
            <CreatorTab
              data={data}
              analysisPhase={analysisPhase}
              products={products}
              onSuggest={onSuggest}
            />
          )}
          {tab === "ask" &&
            (done ? (
              <AskTab data={data} thread={thread} onSend={onSend} pending={askPending} />
            ) : (
              <LoadingTab />
            ))}
        </>
      )}
    </section>
  );
}
