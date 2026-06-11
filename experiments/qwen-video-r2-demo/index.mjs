#!/usr/bin/env node

import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen3.7-plus";
const DEFAULT_MIME_TYPE = "video/mp4";
const DEFAULT_FPS = 2;

const MIME_BY_EXTENSION = new Map([
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".m4v", "video/x-m4v"],
  [".webm", "video/webm"],
  [".avi", "video/x-msvideo"],
  [".mkv", "video/x-matroska"],
]);

class DemoError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "DemoError";
    this.code = code;
    this.cause = cause;
  }
}

function getConfig() {
  return {
    apiKey: process.env.QWEN_API_KEY?.trim() || "",
    baseUrl: process.env.QWEN_BASE_URL?.trim() || DEFAULT_BASE_URL,
    model: process.env.QWEN_MODEL?.trim() || DEFAULT_MODEL,
    publicUrl:
      process.env.QWEN_VIDEO_PUBLIC_URL?.trim() ||
      "https://wangzhrtestbuckets.s3.bitiful.net/v16m.tiktokcdn-us.com&sol;d5fd3619258bc7e7da958bd8bea74592&sol;6a292ed8&sol;video&sol;tos&sol;useast8&sol;tos-useast8-pve-0068-tx2&sol;ogiRFJu0fA37iQDQi9BO3IlAqczvEz6iCNBAIB&sol;&quest;a=1233&bti=OTg7QGo5QHM6O.mp4",
    fps: parsePositiveNumber(process.env.QWEN_VIDEO_FPS, DEFAULT_FPS),
  };
}

function parsePositiveNumber(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildEndpoint(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function validateHttpUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new DemoError(
      "invalid_public_url",
      "QWEN_VIDEO_PUBLIC_URL must be a valid HTTP or HTTPS URL.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DemoError(
      "invalid_public_url",
      "QWEN_VIDEO_PUBLIC_URL must use http or https.",
    );
  }

  return url.toString();
}

async function validateLocalVideoPath(filePath) {
  if (!filePath) {
    throw new DemoError(
      "missing_video_input",
      "Set QWEN_VIDEO_PUBLIC_URL or pass a local video path.",
    );
  }

  const absolutePath = path.resolve(filePath);

  try {
    await access(absolutePath);
  } catch (error) {
    throw new DemoError(
      "local_file_not_found",
      `Local video file does not exist or is not readable: ${absolutePath}`,
      error,
    );
  }

  const stats = await stat(absolutePath);
  if (!stats.isFile()) {
    throw new DemoError(
      "local_file_not_file",
      `Local video path is not a file: ${absolutePath}`,
    );
  }

  if (stats.size === 0) {
    throw new DemoError(
      "local_file_empty",
      `Local video file is empty: ${absolutePath}`,
    );
  }

  return { absolutePath, size: stats.size };
}

function detectMimeType(filePath) {
  return (
    MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) ||
    DEFAULT_MIME_TYPE
  );
}

async function buildBase64VideoUrl(filePath, size) {
  if (size > 7 * 1024 * 1024) {
    console.error(
      `Warning: ${path.basename(filePath)} is ${(size / 1024 / 1024).toFixed(
        1,
      )}MB. DashScope docs recommend Base64 only for small videos; compress or trim if the request fails.`,
    );
  }

  const mimeType = detectMimeType(filePath);
  const buffer = await readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function createMessages(videoUrl, fps) {
  return [
    {
      role: "system",
      content: "你是短视频带货内容分析助手，只输出 JSON。",
    },
    {
      role: "user",
      content: [
        {
          type: "video_url",
          video_url: { url: videoUrl },
          fps,
        },
        {
          type: "text",
          text:
            "分析这个短视频，并只返回一个 JSON object。结构必须是：" +
            '{"summary":"1-3句中文摘要","visualMoments":[{"time":"0:00-0:03","desc":"画面描述"}],"productSignals":["画面中的带货信号"]}。' +
            "visualMoments 返回 3-6 条，按时间顺序排列；productSignals 返回 0-6 条。不要返回 Markdown、代码块或额外解释。",
        },
      ],
    },
  ];
}

async function callQwen({ config, videoUrl }) {
  if (!config.apiKey) {
    throw new DemoError("missing_qwen_api_key", "QWEN_API_KEY is required.");
  }

  const response = await fetch(buildEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: createMessages(videoUrl, config.fps),
      temperature: 0.2,
    }),
  });

  const bodyText = await response.text();

  if (!response.ok) {
    const sizeHint =
      response.status === 413
        ? " Base64 video may be too large; compress the video, trim it, or extract frames before retrying."
        : "";

    throw new DemoError(
      "qwen_request_failed",
      `Qwen request failed with HTTP ${response.status}:${sizeHint} ${summarizeText(bodyText)}`,
    );
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (error) {
    throw new DemoError(
      "qwen_response_parse_failed",
      `Qwen response was not valid JSON: ${summarizeText(bodyText)}`,
      error,
    );
  }

  const content = extractMessageContent(body);
  const parsed = parseModelJson(content);
  return normalizeModelResult(parsed);
}

function extractMessageContent(body) {
  const content = body?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        return part?.text || "";
      })
      .join("");

    if (text) {
      return text;
    }
  }

  throw new DemoError(
    "qwen_empty_message",
    "Qwen response did not include choices[0].message.content.",
  );
}

function parseModelJson(content) {
  const trimmed = content.trim();

  try {
    return JSON.parse(stripCodeFence(trimmed));
  } catch {
    const jsonObject = extractFirstJsonObject(trimmed);
    if (!jsonObject) {
      throw new DemoError(
        "model_json_parse_failed",
        `Model did not return a parseable JSON object: ${summarizeText(content)}`,
      );
    }

    try {
      return JSON.parse(jsonObject);
    } catch (error) {
      throw new DemoError(
        "model_json_parse_failed",
        `Extracted model JSON was invalid: ${summarizeText(jsonObject)}`,
        error,
      );
    }
  }
}

function stripCodeFence(text) {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function normalizeModelResult(value) {
  return {
    summary: typeof value?.summary === "string" ? value.summary : "",
    visualMoments: Array.isArray(value?.visualMoments)
      ? value.visualMoments.slice(0, 6).map((moment) => ({
          time: typeof moment?.time === "string" ? moment.time : "",
          desc: typeof moment?.desc === "string" ? moment.desc : "",
        }))
      : [],
    productSignals: Array.isArray(value?.productSignals)
      ? value.productSignals
          .filter((signal) => typeof signal === "string")
          .slice(0, 6)
      : [],
  };
}

function summarizeError(error) {
  if (error instanceof DemoError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function summarizeText(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function successResult(inputMode, modelResult, urlAttemptError = null) {
  return {
    ok: true,
    inputMode,
    summary: modelResult.summary,
    visualMoments: modelResult.visualMoments,
    productSignals: modelResult.productSignals,
    urlAttemptError,
    error: null,
  };
}

function failureResult(error, urlAttemptError = null) {
  return {
    ok: false,
    inputMode: "failed",
    summary: "",
    visualMoments: [],
    productSignals: [],
    urlAttemptError,
    error: summarizeError(error),
  };
}

async function run() {
  const config = getConfig();
  const localPathArg = process.argv[2];

  if (config.publicUrl) {
    const publicUrl = validateHttpUrl(config.publicUrl);

    try {
      const modelResult = await callQwen({ config, videoUrl: publicUrl });
      return successResult("public_url", modelResult);
    } catch (urlError) {
      if (!localPathArg) {
        return failureResult(urlError);
      }

      const urlAttemptError = summarizeError(urlError);

      try {
        const { absolutePath, size } =
          await validateLocalVideoPath(localPathArg);
        const base64Url = await buildBase64VideoUrl(absolutePath, size);
        const modelResult = await callQwen({ config, videoUrl: base64Url });
        return successResult("base64", modelResult, urlAttemptError);
      } catch (base64Error) {
        return failureResult(base64Error, urlAttemptError);
      }
    }
  }

  const { absolutePath, size } = await validateLocalVideoPath(localPathArg);
  const base64Url = await buildBase64VideoUrl(absolutePath, size);
  const modelResult = await callQwen({ config, videoUrl: base64Url });
  return successResult("base64", modelResult);
}

try {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify(failureResult(error), null, 2));
  process.exitCode = 1;
}
