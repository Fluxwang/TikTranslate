"use client";

import { useEffect, useState } from "react";

import { loadProducts, saveProducts } from "@/lib/analysis";
import type { Product } from "@/lib/types";

/**
 * 产品列表，持久化在 localStorage。
 *
 * useState 的初始值用惰性初始化（传函数而不是传值）：loadProducts 会读
 * localStorage，直接传 `loadProducts()` 会导致每次渲染都执行一次读取，
 * 尽管只有首次的结果会被采用。
 *
 * 写回放在 effect 里而不是包一层 setProducts：调用方拿到的就是原生的
 * setState，可以照常用函数式更新，不需要知道背后还有持久化这回事。
 */
export function useProducts() {
  const [products, setProducts] = useState<Product[]>(() => loadProducts());

  useEffect(() => {
    saveProducts(products);
  }, [products]);

  return { products, setProducts };
}
