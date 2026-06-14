import { verifyJWT } from '@/lib/auth';
import type { HookItem, Product, ScriptTemplate, SuggestAnalysis, SuggestResponse, VideoStructureSegment } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
}

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseJsonObject(content: string) {
  return JSON.parse(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isProduct(value: unknown): value is Product {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.audience) &&
    isNonEmptyString(value.sellingPoints) &&
    isNonEmptyString(value.scene)
  );
}

function isHookItem(value: unknown): value is HookItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.time === 'string' &&
    typeof value.src === 'string' &&
    typeof value.zh === 'string' &&
    typeof value.tag === 'string'
  );
}

function isVideoStructureSegment(value: unknown): value is VideoStructureSegment {
  if (!isRecord(value)) return false;
  return (
    typeof value.title === 'string' &&
    typeof value.time === 'string' &&
    typeof value.desc === 'string' &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string')
  );
}

function isScriptTemplate(value: unknown): value is ScriptTemplate {
  if (!isRecord(value)) return false;
  return typeof value.type === 'string' && typeof value.text === 'string';
}

function isSuggestAnalysis(value: unknown): value is SuggestAnalysis {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.hooks) &&
    value.hooks.every(isHookItem) &&
    Array.isArray(value.videoStructure) &&
    value.videoStructure.every(isVideoStructureSegment) &&
    Array.isArray(value.templates) &&
    value.templates.every(isScriptTemplate) &&
    Array.isArray(value.sellingPoints) &&
    value.sellingPoints.every((item) => typeof item === 'string') &&
    typeof value.summary === 'string'
  );
}

function validateSuggestResponse(value: unknown): SuggestResponse {
  if (!isRecord(value)) {
    throw new Error('suggest response is not an object');
  }

  if (!isNonEmptyString(value.en) || !isNonEmptyString(value.es) || !isNonEmptyString(value.zh)) {
    throw new Error('suggest response missing required language fields');
  }

  return {
    en: value.en,
    es: value.es,
    zh: value.zh,
  };
}

function formatHooks(hooks: HookItem[]) {
  if (hooks.length === 0) return 'None extracted.';
  return hooks
    .map((hook) => `- ${hook.time} | ${hook.tag}\n  Original: ${hook.src}\n  Chinese: ${hook.zh}`)
    .join('\n');
}

function formatVideoStructure(videoStructure: VideoStructureSegment[]) {
  if (videoStructure.length === 0) return 'None extracted.';
  return videoStructure
    .map((segment) => `- ${segment.time} | ${segment.title}\n  Why it worked: ${segment.desc}\n  Tags: ${segment.tags.join(', ')}`)
    .join('\n');
}

function formatTemplates(templates: ScriptTemplate[]) {
  if (templates.length === 0) return 'None extracted.';
  return templates
    .map((template) => `- ${template.type}: ${template.text}`)
    .join('\n');
}

function formatSellingPoints(sellingPoints: string[]) {
  if (sellingPoints.length === 0) return 'None extracted.';
  return sellingPoints.map((point) => `- ${point}`).join('\n');
}

function buildPrompt(product: Product, analysis: SuggestAnalysis) {
  return `You are an experienced TikTok e-commerce content consultant.

The user has analyzed a viral product video and extracted the following insights.
Note: some fields may be empty if the analysis could not extract them - do your best with what's available.

[Video Summary]
${analysis.summary || 'None extracted.'}

[Successful Hook Lines]
${formatHooks(analysis.hooks)}

[Video Narrative Structure]
${formatVideoStructure(analysis.videoStructure)}

[Reusable Script Templates]
${formatTemplates(analysis.templates)}

[Core Selling Points from Video]
${formatSellingPoints(analysis.sellingPoints)}

[Product to Promote]
Name: ${product.name}
Target audience: ${product.audience}
Key selling points: ${product.sellingPoints}
Use scenario: ${product.scene}

Based on the viral video analysis above, write a content coaching message to send to a NEW creator who just received this product.

Requirements:
- Warm and friendly tone - like advice from a friend, not instructions from a client
- Open with one genuine compliment about the creator
- Give 5-6 specific, actionable filming tips
- For each tip, briefly explain WHY it works (rooted in the viral video's success)
- For each tip, include one concrete example line the creator could actually say
- Example lines should tie to the product's real use scenario (${product.scene})
- Close with encouragement for the creator to make it their own

Output ONLY valid JSON with exactly these three fields - no Markdown, no code block:
{
  "en": "English version (for English/international creators)",
  "es": "Spanish version (for Spanish-speaking creators)",
  "zh": "Chinese version (for operator reference)"
}`;
}

async function requestSuggestion(product: Product, analysis: SuggestAnalysis) {
  const baseUrl = getRequiredEnv('SUGGEST_BASE_URL').replace(/\/$/, '');
  const apiKey = getRequiredEnv('SUGGEST_API_KEY');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.SUGGEST_MODEL ?? 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a TikTok e-commerce content consultant. Output only valid JSON.',
        },
        {
          role: 'user',
          content: buildPrompt(product, analysis),
        },
      ],
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`LLM status ${res.status}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    const err = new Error('missing content');
    err.name = 'SuggestionParseError';
    throw err;
  }

  try {
    return validateSuggestResponse(parseJsonObject(content));
  } catch (err) {
    const parseErr = new Error(err instanceof Error ? err.message : 'suggestion JSON parse failed');
    parseErr.name = 'SuggestionParseError';
    throw parseErr;
  }
}

export async function POST(req: Request) {
  try {
    await verifyJWT(req);
  } catch (err) {
    return error(401, 'unauthorized', err instanceof Error ? err.message : undefined);
  }

  let body: { product?: unknown; analysis?: unknown };
  try {
    body = await req.json();
  } catch {
    return error(400, 'missing_fields');
  }

  if (!isProduct(body.product) || !isSuggestAnalysis(body.analysis)) {
    return error(400, 'missing_fields');
  }

  try {
    return json(await requestSuggestion(body.product, body.analysis));
  } catch (err) {
    if (err instanceof Error && err.name === 'SuggestionParseError') {
      return error(500, 'suggestion_parse_failed');
    }
    return error(502, 'llm_failed');
  }
}
