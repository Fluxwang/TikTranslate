"use client";

import { useState, type ChangeEvent } from "react";

import type { Product } from "@/lib/types";

/**
 * 单个产品的展示 / 编辑卡片。
 *
 * 编辑用的是本地草稿（form）而不是直接改上层状态：这样「取消」才能真正
 * 丢弃改动。startEdit 和 cancel 都会把草稿重置回 product——进入编辑时重置是
 * 为了防止上一次取消后残留的旧草稿被带进来。
 */
export function ProductCard({
  product,
  onSave,
}: {
  product: Product;
  onSave: (next: Product) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(product);

  const updateField =
    (key: keyof Product) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

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
            <input className="field-input" value={form.name} onChange={updateField("name")} />
          </div>
          <div>
            <label className="field-label">Target audience</label>
            <textarea
              className="field-area"
              rows={2}
              value={form.audience}
              onChange={updateField("audience")}
            />
          </div>
          <div>
            <label className="field-label">Core selling points (comma separated)</label>
            <textarea
              className="field-area"
              rows={3}
              value={form.sellingPoints}
              onChange={updateField("sellingPoints")}
            />
          </div>
          <div>
            <label className="field-label">Key usage scenes</label>
            <textarea
              className="field-area"
              rows={2}
              value={form.scene}
              onChange={updateField("scene")}
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
