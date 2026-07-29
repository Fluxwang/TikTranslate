"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * 明暗主题。
 *
 * 主题值写到 <html data-theme>，由 app/globals.css 里的 CSS 变量接管，
 * 而不是让每个组件自己读 theme 再切 className——那样每次切换都会触发
 * 整棵树重渲染，而改一个 DOM 属性不会。
 */
export function useTheme(initial: Theme = "light") {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
