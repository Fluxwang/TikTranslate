"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildCreatorSuggestion } from "@/lib/analysis";
import type { AnalysisData, AnalysisPhase, Phase, Product } from "@/lib/types";

interface Props {
  phase: Phase;
  analysisPhase: AnalysisPhase;
  analysisStep: number;
  analysisError: string;
  data: AnalysisData;
  durationSec: number;
  products: Product[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  thread: { q: string; a: string | null }[];
  onSend: (q: string) => void;
  askPending: boolean;
}

const MD_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: () => null,
};

const ICONS = {
  sparkles: (
    <path d="M12 3l1.912 5.813H20l-4.956 3.562L16.912 18 12 14.438 7.088 18l1.868-5.625L4 8.813h6.088L12 3z" />
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  tag: (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  chartBar: (
    <>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  ),
  list: (
    <>
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
      <path d="M3 6h.01" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M8 6h13" />
    </>
  ),
  bolt: (
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  ),
  messages: (
    <>
      <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  send: (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
} as const satisfies Record<string, ReactNode>;

function Icon({
  name,
  size = 14,
}: {
  name: keyof typeof ICONS;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
    >
      {ICONS[name]}
    </svg>
  );
}

function fmtTime(sec: number) {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function CardSkeleton({ lines }: { lines: number }) {
  return (
    <div>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          className="sk-block"
          key={i}
          style={{ width: `${95 - i * 14}%` }}
        />
      ))}
    </div>
  );
}

function LoadingTab() {
  return (
    <div className="ai-body">
      <CardSkeleton lines={3} />
      <div style={{ height: 8 }} />
      <CardSkeleton lines={4} />
    </div>
  );
}

function EmptyTab({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="ai-body">
      <div className="empty">
        <div className="ei">
          <Icon name="info" size={18} />
        </div>
        <div className="et">{title}</div>
        <div className="es">{description}</div>
      </div>
    </div>
  );
}

const AI_TABS = [
  { id: "overview", label: "概览" },
  { id: "structure", label: "视频结构" },
  { id: "scripts", label: "爆点话术" },
  { id: "creator", label: "达人建议" },
  { id: "ask", label: "追问 AI" },
] as const;

type TabId = (typeof AI_TABS)[number]["id"];

/* ============================================================
   TAB 1 — 概览
   ============================================================ */
function OverviewTab({
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
          <div className="big accent">
            {step >= 2 ? data.overall.score.toFixed(1) : "—"}
          </div>
          <div className="sub">{step >= 2 ? data.overall.label : " "}</div>
        </div>
        <div className="stat-card enter">
          <div className="cap">视频时长</div>
          <div className="big">{fmtTime(durationSec)}</div>
          <div className="sub">{data.duration.label || " "}</div>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">
          <Icon name="tag" size={15} /> 核心卖点
        </div>
        {step >= 1 ? (
          <div className="tag-group">
            {data.sellingPoints.map((p, i) => (
              <span className={`pill-c c-${p.color}`} key={i}>
                {p.text}
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
            {data.scores.map((s, i) => (
              <div className={`score-row c-${s.color}`} key={i}>
                <span className="dim">{s.dim}</span>
                <div className="score-bar">
                  <div className="fill c" style={{ width: `${s.pct}%` }} />
                </div>
                <span className="val">{s.val.toFixed(1)}</span>
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

/* ============================================================
   TAB 2 — 视频结构
   ============================================================ */
function StructureTab({ data }: { data: AnalysisData }) {
  if (data.videoStructure.length === 0) {
    return (
      <EmptyTab
        title="暂无视频结构数据"
        description="该卡片展示 AI 对视频叙事结构的分段拆解，需后端在分析结果中返回 videoStructure 字段，详见集成文档。"
      />
    );
  }

  return (
    <div className="ai-body">
      <div className="sec-title">
        <Icon name="list" size={15} /> 视频叙事结构拆解
      </div>
      <div className="struct-list">
        {data.videoStructure.map((seg, i) => (
          <div className="struct-item" key={i}>
            <div className="struct-num">{i + 1}</div>
            <div className="struct-body">
              <div className="struct-head">
                <span className="ttl">{seg.title}</span>
                <span className="ts">{seg.time}</span>
              </div>
              <p className="desc">{seg.desc}</p>
              <div className="struct-tags">
                {seg.tags.map((t, j) => (
                  <span className="t" key={j}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   TAB 3 — 爆点话术
   ============================================================ */
function renderSlots(text: string) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((p, i) =>
    /^\[[^\]]+\]$/.test(p) ? (
      <span className="slot" key={i}>
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function ScriptsTab({ data }: { data: AnalysisData }) {
  if (data.hooks.length === 0 && data.templates.length === 0) {
    return (
      <EmptyTab
        title="暂无爆点话术数据"
        description="该 Tab 展示高效钩子提取与可复用话术模板，需后端在分析结果中返回 hooks 和 templates 字段，详见集成文档。"
      />
    );
  }

  return (
    <div className="ai-body">
      {data.hooks.length > 0 && (
        <div className="sec">
          <div className="sec-title">
            <Icon name="bolt" size={15} /> 高效钩子话术提取
          </div>
          <div className="hook-list">
            {data.hooks.map((h, i) => (
              <div className="hook-card" key={i}>
                <div className="ts">{h.time}</div>
                <div className="src">{h.src}</div>
                <div className="zh">{h.zh}</div>
                <span className="hook-tag">{h.tag}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.templates.length > 0 && (
        <div className="sec">
          <div className="sec-title">
            <Icon name="messages" size={15} /> 可复用话术模板
          </div>
          <div className="tpl-list">
            {data.templates.map((tpl, i) => (
              <div className="tpl-card" key={i}>
                <span className="type">{tpl.type}</span>
                <div className="body">{renderSlots(tpl.text)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TAB 4 — 达人建议（核心功能）
   ============================================================ */
function CreatorTab({
  data,
  products,
}: {
  data: AnalysisData;
  products: Product[];
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  // 设置页删了某个产品时，回退到第一个
  const product = products.find((p) => p.id === productId) ?? products[0];

  const onGenerate = () => {
    if (!product || loading) return;
    setLoading(true);
    setResult("");
    setCopied(false);
    // 占位实现：前端模板拼接生成英文建议。
    // 后续可替换为调用 /api/suggest 由 AI 实时生成，详见集成文档。
    window.setTimeout(() => {
      setResult(buildCreatorSuggestion(product, data));
      setLoading(false);
    }, 500);
  };

  const onCopy = () => {
    const done = () => {
      setCopied(true);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(result).then(done, done);
    } else {
      done();
    }
  };

  if (!product) return null;

  return (
    <div className="ai-body creator-body">
      {/* 固定在顶部的控件区域 */}
      <div className="creator-controls">
        <div className="gen-label">Select product</div>
        <select
          className="gen-select"
          value={product.id}
          onChange={(e) => setProductId(e.target.value)}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="gen-btn" disabled={loading} onClick={onGenerate}>
          {loading ? (
            <>
              <span className="spinner" /> Generating...
            </>
          ) : (
            "Generate creator suggestion"
          )}
        </button>
      </div>

      {/* 可滚动的结果区域 */}
      <div className="creator-result">
        {loading && !result && (
          <div className="gen-result">
            <div className="gen-body">
              <CardSkeleton lines={5} />
            </div>
          </div>
        )}
        {result && (
          <div className="gen-result">
            <div className="bar">
              <span className="ready">
                <span className="dot" /> Ready to send
              </span>
              <button
                className={`copy-btn${copied ? " copied" : ""}`}
                onClick={onCopy}
              >
                {copied ? (
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
            <div className="gen-body">{result}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   TAB 5 — 追问 AI
   ============================================================ */
function AskTab({
  data,
  thread,
  onSend,
  pending,
}: {
  data: AnalysisData;
  thread: { q: string; a: string | null }[];
  onSend: (q: string) => void;
  pending: boolean;
}) {
  const [val, setVal] = useState("");
  const [focused, setFocused] = useState(false);

  const submit = (text?: string) => {
    const q = (text ?? val).trim();
    if (!q || pending) return;
    onSend(q);
    setVal("");
  };

  return (
    <div className="ai-body">
      {thread.length > 0 ? (
        <div className="ask-thread">
          {thread.map((m, i) => (
            <div key={i}>
              <div className="ask-msg q">{m.q}</div>
              <div className="ask-msg a" style={{ marginTop: 4 }}>
                <span className="who">AI</span>
                <div className="ask-msg-body">
                  {m.a == null ? (
                    <span
                      className="spinner"
                      style={{ display: "inline-block" }}
                    />
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={MD_COMPONENTS}
                    >
                      {m.a}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        data.suggestedQuestions.length > 0 && (
          <div className="ask-chips">
            {data.suggestedQuestions.map((q, i) => (
              <button className="ask-chip" key={i} onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
        )
      )}

      <div className={`ask${focused ? " focused" : ""}`}>
        <div className="ask-input-row">
          <textarea
            rows={1}
            value={val}
            placeholder="追问 AI..."
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setVal(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(80, e.target.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            className={`send${val.trim() ? " ready" : ""}`}
            onClick={() => submit()}
          >
            <Icon name="send" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   产品设置页（覆盖整个侧栏）
   ============================================================ */
function ProductCard({
  product,
  onSave,
}: {
  product: Product;
  onSave: (p: Product) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(product);

  const upd =
    (k: keyof Product) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  const startEdit = () => {
    setForm(product);
    setEditing(true);
  };
  const save = () => {
    onSave(form);
    setEditing(false);
  };
  const cancel = () => {
    setForm(product);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="prod-card">
        <div className="prod-form">
          <div>
            <label className="field-label">Product name</label>
            <input
              className="field-input"
              value={form.name}
              onChange={upd("name")}
            />
          </div>
          <div>
            <label className="field-label">Target audience</label>
            <textarea
              className="field-area"
              rows={2}
              value={form.audience}
              onChange={upd("audience")}
            />
          </div>
          <div>
            <label className="field-label">
              Core selling points (comma separated)
            </label>
            <textarea
              className="field-area"
              rows={3}
              value={form.sellingPoints}
              onChange={upd("sellingPoints")}
            />
          </div>
          <div>
            <label className="field-label">Key usage scenes</label>
            <textarea
              className="field-area"
              rows={2}
              value={form.scene}
              onChange={upd("scene")}
            />
          </div>
          <div className="prod-actions">
            <button className="btn-sm primary" onClick={save}>
              Save
            </button>
            <button className="btn-sm ghost" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="prod-card">
      <div className="prod-top">
        <span className="prod-name">{product.name}</span>
        <button className="prod-edit" onClick={startEdit}>
          Edit
        </button>
      </div>
      <div className="prod-field">
        <div className="k">Audience</div>
        <div className="v">{product.audience}</div>
      </div>
      <div className="prod-field">
        <div className="k">Selling points</div>
        <div className="v">{product.sellingPoints}</div>
      </div>
      <div className="prod-field">
        <div className="k">Scene</div>
        <div className="v">{product.scene}</div>
      </div>
    </div>
  );
}

function SettingsPage({
  products,
  setProducts,
  onClose,
}: {
  products: Product[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  onClose: () => void;
}) {
  const saveProduct = (next: Product) =>
    setProducts((list) => list.map((p) => (p.id === next.id ? next : p)));

  return (
    <div className="settings">
      <div className="settings-head">
        <span className="ttl">Product Settings</span>
        <button className="settings-close" onClick={onClose}>
          <Icon name="x" size={13} /> Close
        </button>
      </div>
      <div className="settings-body">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} onSave={saveProduct} />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   主面板
   ============================================================ */
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
  askPending,
}: Props) {
  const [tab, setTab] = useState<TabId>("overview");
  const [settings, setSettings] = useState(false);

  const started = analysisPhase !== "none";
  const done = analysisPhase === "done";

  if (settings) {
    return (
      <section className="col">
        <SettingsPage
          products={products}
          setProducts={setProducts}
          onClose={() => setSettings(false)}
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
          {!started ? (
            <button
              className="btn btn-ghost"
              style={{ height: 26, padding: "0 10px", fontSize: 11 }}
              disabled
            >
              等待字幕
            </button>
          ) : analysisPhase === "analyzing" ? (
            <button
              className="btn btn-ghost"
              style={{ height: 26, padding: "0 10px", fontSize: 11 }}
              disabled
            >
              <span className="spinner" /> 分析中
            </button>
          ) : analysisPhase === "failed" ? (
            <span className="beta" style={{ textTransform: "none" }}>
              失败
            </span>
          ) : (
            <span
              className="beta"
              style={{ textTransform: "none", whiteSpace: "nowrap" }}
            >
              <Icon name="check" size={11} /> 已完成
            </span>
          )}
          <button
            className="icon-btn gear"
            title="产品设置"
            onClick={() => setSettings(true)}
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
          <div className="et">
            {phase === "recognized" ? "字幕已就绪" : "等待字幕识别完成"}
          </div>
          <div className="es">
            {phase === "recognized"
              ? "AI 将自动提取卖点、拆解视频结构、给视频打分并生成达人建议。"
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
            {analysisError ||
              "请检查 ANALYSIS_BASE_URL、ANALYSIS_API_KEY 和模型配置。"}
          </div>
        </div>
      ) : (
        <>
          <div className="ai-tabnav">
            {AI_TABS.map((t) => (
              <button
                key={t.id}
                className={`tab${tab === t.id ? " on" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <OverviewTab
              data={data}
              durationSec={durationSec}
              step={analysisStep}
            />
          )}
          {tab === "structure" &&
            (done ? <StructureTab data={data} /> : <LoadingTab />)}
          {tab === "scripts" &&
            (done ? <ScriptsTab data={data} /> : <LoadingTab />)}
          {tab === "creator" &&
            (done ? (
              <CreatorTab data={data} products={products} />
            ) : (
              <LoadingTab />
            ))}
          {tab === "ask" &&
            (done ? (
              <AskTab
                data={data}
                thread={thread}
                onSend={onSend}
                pending={askPending}
              />
            ) : (
              <LoadingTab />
            ))}
        </>
      )}
    </section>
  );
}
