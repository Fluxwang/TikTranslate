"use client";

import type { Dispatch, SetStateAction } from "react";

import { ProductCard } from "./ProductCard";
import { Icon } from "../shared/Icon";
import type { Product } from "@/lib/types";

/**
 * 产品设置页，覆盖整个 AI 侧栏。
 *
 * 做成同一列内的整页覆盖而不是弹窗：这一列本来就窄，弹窗要么撑不下表单，
 * 要么盖住左侧的视频，两种都比直接换一整页体验差。
 */
export function SettingsPage({
  products,
  setProducts,
  onClose,
}: {
  products: Product[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  onClose: () => void;
}) {
  const saveProduct = (next: Product) =>
    setProducts((list) => list.map((item) => (item.id === next.id ? next : item)));

  return (
    <div className="settings">
      <div className="settings-head">
        <span className="ttl">Product Settings</span>
        <button className="settings-close" onClick={onClose}>
          <Icon name="x" size={13} /> Close
        </button>
      </div>
      <div className="settings-body">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} onSave={saveProduct} />
        ))}
      </div>
    </div>
  );
}
