"use client";

import { useState } from "react";

import { Icon } from "../shared/Icon";
import { Markdown } from "../shared/Markdown";
import type { ChatTurn } from "@/hooks/useChat";
import type { AnalysisData } from "@/lib/types";

/** 输入框自动增高的上限（px），超过后内部滚动。 */
const TEXTAREA_MAX_HEIGHT = 80;

/** 追问 AI Tab：基于字幕与分析结果的多轮对话。 */
export function AskTab({
  data,
  thread,
  onSend,
  pending,
}: {
  data: AnalysisData;
  thread: ChatTurn[];
  onSend: (question: string) => void;
  pending: boolean;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  const submit = (text?: string) => {
    const question = (text ?? value).trim();
    if (!question || pending) return;
    onSend(question);
    setValue("");
  };

  return (
    <div className="ai-body">
      {thread.length > 0 ? (
        <div className="ask-thread">
          {thread.map((turn, i) => (
            <div key={i}>
              <div className="ask-msg q">{turn.q}</div>
              <div className="ask-msg a" style={{ marginTop: 4 }}>
                <span className="who">AI</span>
                <div className="ask-msg-body">
                  {/* a 为 null 表示还在等回复；空字符串表示这一轮失败了 */}
                  {turn.a == null ? (
                    <span className="spinner" style={{ display: "inline-block" }} />
                  ) : (
                    <Markdown>{turn.a}</Markdown>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // 还没提过问时，用 AI 给的建议问题做引导——空白输入框对用户没有提示作用
        data.suggestedQuestions.length > 0 && (
          <div className="ask-chips">
            {data.suggestedQuestions.map((question, i) => (
              <button className="ask-chip" key={i} onClick={() => submit(question)}>
                {question}
              </button>
            ))}
          </div>
        )
      )}

      <div className={`ask${focused ? " focused" : ""}`}>
        <div className="ask-input-row">
          <textarea
            rows={1}
            value={value}
            placeholder="追问 AI..."
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              setValue(event.target.value);
              // 先归零再读 scrollHeight：不重置的话 scrollHeight 只增不减，
              // 删除文字后输入框不会缩回去
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(TEXTAREA_MAX_HEIGHT, event.target.scrollHeight)}px`;
            }}
            onKeyDown={(event) => {
              // Enter 发送，Shift+Enter 换行——聊天输入框的通用约定
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button className={`send${value.trim() ? " ready" : ""}`} onClick={() => submit()}>
            <Icon name="send" />
          </button>
        </div>
      </div>
    </div>
  );
}
