import { describe, expect, it } from "vitest";

import { formatTime, stripMarkdown } from "./format";

describe("formatTime", () => {
  it("按 m:ss 补零", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(59)).toBe("0:59");
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(3661)).toBe("61:01"); // 超过一小时不进位到 h:mm:ss
  });

  it("向下取整，不四舍五入", () => {
    // 播放到 9.9 秒时字幕时间轴仍应显示 0:09，取整到 0:10 会和字幕对不上
    expect(formatTime(9.9)).toBe("0:09");
  });

  it("非法输入一律按 0 处理，界面上不出现 NaN", () => {
    // <video>.duration 在元数据加载完成前就是 NaN
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
    expect(formatTime(null)).toBe("0:00");
    expect(formatTime(undefined)).toBe("0:00");
    expect(formatTime("abc")).toBe("0:00");
  });
});

describe("stripMarkdown", () => {
  it("去掉标题标记但保留标题文字", () => {
    expect(stripMarkdown("## 拍摄建议")).toBe("拍摄建议");
  });

  it("去掉粗体、斜体、删除线、行内代码标记", () => {
    expect(stripMarkdown("**重点** 和 *强调* 和 ~~删除~~ 和 `代码`")).toBe(
      "重点 和 强调 和 删除 和 代码",
    );
  });

  it("链接只保留文字", () => {
    expect(stripMarkdown("参考[这个视频](https://example.com)")).toBe("参考这个视频");
  });

  it("去掉列表与引用标记", () => {
    expect(stripMarkdown("- 第一条\n- 第二条")).toBe("第一条\n第二条");
    expect(stripMarkdown("1. 第一条\n2. 第二条")).toBe("第一条\n第二条");
    expect(stripMarkdown("> 引用")).toBe("引用");
  });

  it("折叠三行以上的空行并去掉首尾空白", () => {
    expect(stripMarkdown("  a\n\n\n\nb  ")).toBe("a\n\nb");
  });

  it("纯文本原样返回", () => {
    expect(stripMarkdown("就是一句普通的话")).toBe("就是一句普通的话");
  });
});
