import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 只测纯函数层（lib/ 下的无副作用模块）。
// 组件与 hooks 不在这里测：它们依赖 MediaRecorder / captureStream 等浏览器 API，
// mock 成本远高于收益，改为靠分步提交 + 人工验证覆盖（见 AGENTS.md 测试约定）。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts", "lib/types.ts"],
    },
  },
});
