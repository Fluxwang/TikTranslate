import { verifyJWT } from '@/lib/auth';

export const maxDuration = 60;

const AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
const MAX_SUBTITLE_CHARS = 130;
const MIN_SUBTITLE_WORDS = 4;
const LONG_GAP_SECONDS = 0.8;
const FALLBACK_WORDS_PER_SECOND = 2.6;

type WhisperSegment = {
  start?: number;
  text?: string;
};

type WhisperWord = {
  word?: string;
  start?: number;
  end?: number;
};

type OpenRouterTranscriptionResponse = {
  text?: string;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
};

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

function getAudioFormat(audio: Blob) {
  const mimeType = audio.type.split(';')[0].trim().toLowerCase();
  const subtype = mimeType.split('/')[1];

  if (!subtype) return 'webm';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'mp4') return 'm4a';
  return subtype.replace(/^x-/, '');
}

async function blobToBase64(blob: Blob) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  return buffer.toString('base64');
}

async function readUpstreamError(res: Response) {
  const text = await res.text().catch(() => '');
  return text ? `Whisper status ${res.status}: ${text.slice(0, 1000)}` : `Whisper status ${res.status}`;
}

function joinWords(words: string[]) {
  return words.join('').replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

function shouldEndSubtitle(text: string, wordCount: number, gapToNext: number | null) {
  const hasEnoughWords = wordCount >= MIN_SUBTITLE_WORDS;
  const endsSentence = /[.!?。！？]$/.test(text);
  const endsPhrase = /[,;:，；：]$/.test(text);

  if (hasEnoughWords && endsSentence) return true;
  if (hasEnoughWords && gapToNext != null && gapToNext >= LONG_GAP_SECONDS) return true;
  if (text.length >= MAX_SUBTITLE_CHARS && (endsPhrase || endsSentence)) return true;
  return text.length >= MAX_SUBTITLE_CHARS * 1.3;
}

function segmentsFromWords(words: WhisperWord[]): WhisperSegment[] {
  const validWords = words.filter(
    (word): word is Required<Pick<WhisperWord, 'word' | 'start'>> & WhisperWord =>
      typeof word.word === 'string' && word.word.trim().length > 0 && typeof word.start === 'number',
  );

  const segments: WhisperSegment[] = [];
  let start = 0;
  let currentWords: string[] = [];
  let wordCount = 0;

  validWords.forEach((word, index) => {
    if (currentWords.length === 0) {
      start = word.start;
    }

    currentWords.push(word.word);
    wordCount++;

    const text = joinWords(currentWords);
    const nextWord = validWords[index + 1];
    const gapToNext = typeof word.end === 'number' && nextWord ? nextWord.start - word.end : null;

    if (shouldEndSubtitle(text, wordCount, gapToNext)) {
      segments.push({ start, text });
      currentWords = [];
      wordCount = 0;
    }
  });

  const text = joinWords(currentWords);
  if (text) {
    segments.push({ start, text });
  }

  return segments;
}

function splitLongSubtitle(text: string) {
  if (text.length <= MAX_SUBTITLE_CHARS) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_SUBTITLE_CHARS) {
    const windowText = remaining.slice(0, MAX_SUBTITLE_CHARS);
    const punctuationBreakAt = Math.max(
      windowText.lastIndexOf('. '),
      windowText.lastIndexOf('? '),
      windowText.lastIndexOf('! '),
      windowText.lastIndexOf(', '),
      windowText.lastIndexOf('; '),
      windowText.lastIndexOf(': '),
    );
    const wordBreakAt = windowText.lastIndexOf(' ');
    const breakAt = punctuationBreakAt > MAX_SUBTITLE_CHARS * 0.45 ? punctuationBreakAt : wordBreakAt;
    const cutAt = breakAt > MAX_SUBTITLE_CHARS * 0.45 ? breakAt + 1 : MAX_SUBTITLE_CHARS;
    parts.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function splitFallbackText(text: string) {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) ?? [text];
  return sentences.flatMap((sentence) => splitLongSubtitle(sentence.trim())).filter(Boolean);
}

function estimateDurationSec(text: string, durationSec: number) {
  if (Number.isFinite(durationSec) && durationSec > 0) return durationSec;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, wordCount / FALLBACK_WORDS_PER_SECOND);
}

function segmentsFromText(text: string, durationSec: number): WhisperSegment[] {
  const parts = splitFallbackText(text);
  const totalChars = parts.reduce((sum, part) => sum + part.length, 0);
  if (parts.length === 0 || totalChars === 0) return [];

  const effectiveDurationSec = estimateDurationSec(text, durationSec);
  let consumedChars = 0;

  return parts.map((part) => {
    const start = (consumedChars / totalChars) * effectiveDurationSec;
    consumedChars += part.length;
    return { start, text: part };
  });
}

function getSegments(payload: OpenRouterTranscriptionResponse, durationSec: number): WhisperSegment[] {
  if (Array.isArray(payload.words) && payload.words.length > 0) {
    const wordSegments = segmentsFromWords(payload.words);
    if (wordSegments.length > 0) return wordSegments;
  }

  if (Array.isArray(payload.segments)) {
    return payload.segments.filter((seg) => typeof seg.text === 'string' && seg.text.trim().length > 0);
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  return text ? segmentsFromText(text, durationSec) : [];
}

function parseJsonContent(content: string) {
  const trimmed = content.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(withoutFence);
}

function pickTranslation(item: unknown) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';

  const { zh, translation } = item as { zh?: unknown; translation?: unknown };
  return typeof zh === 'string' ? zh : typeof translation === 'string' ? translation : '';
}

function normalizeTranslations(value: unknown, count: number) {
  const translations = Array.from({ length: count }, () => '');

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (index < count) {
        translations[index] = pickTranslation(item);
      }
    });
    return translations;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    translations.forEach((_, index) => {
      translations[index] = pickTranslation(record[String(index)]);
    });
  }

  return translations;
}

async function translateSegments(texts: string[]) {
  if (texts.length === 0) return [];

  const baseUrl = process.env.ANALYSIS_BASE_URL;
  const apiKey = process.env.ANALYSIS_API_KEY;
  const model = process.env.ANALYSIS_MODEL ?? 'claude-sonnet-4-6';

  async function requestTranslation(prompt: string) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是一个翻译助手，只输出翻译结果，不解释、不补充。' },
          { role: 'user', content: prompt },
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
      throw new Error('missing translation content');
    }

    return content;
  }

  async function batchOnce() {
    const items = texts.map((text, index) => ({ id: index, text }));
    const content = await requestTranslation(
      `逐条翻译以下 JSON 数组中的 text 字段为中文。必须返回一个 JSON 对象，key 必须是原 id，value 必须是对应中文译文。不要合并、不要省略、不要改 key、不要输出 JSON 之外的内容。\n${JSON.stringify(items)}`,
    );
    return normalizeTranslations(parseJsonContent(content), texts.length);
  }

  async function translateOne(text: string) {
    try {
      const content = await requestTranslation(`将以下文本翻译成中文，只输出译文，不要解释。\n${text}`);
      return content.trim();
    } catch {
      return '';
    }
  }

  let translations = texts.map(() => '');
  try {
    translations = await batchOnce();
  } catch {
    try {
      translations = await batchOnce();
    } catch {}
  }

  return Promise.all(
    translations.map((translation, index) => translation || translateOne(texts[index])),
  );
}

export async function POST(req: Request) {
  try {
    await verifyJWT(req);
  } catch (err) {
    return error(401, 'unauthorized', err instanceof Error ? err.message : undefined);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error(400, 'missing_audio');
  }

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    return error(400, 'missing_audio');
  }

  if (audio.size > AUDIO_LIMIT_BYTES) {
    return error(413, 'audio_too_large');
  }

  const startOffset = Number.parseFloat(String(form.get('startOffset') ?? '0'));
  const durationSec = Number.parseFloat(String(form.get('durationSec') ?? '0'));

  const baseUrl = process.env.WHISPER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  let upstream: Response;
  try {
    const apiKey = getRequiredEnv('OPENROUTER_API_KEY');
    upstream = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.WHISPER_MODEL ?? 'openai/whisper-large-v3-turbo',
        input_audio: {
          data: await blobToBase64(audio),
          format: getAudioFormat(audio),
        },
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
      }),
      cache: 'no-store',
    });
  } catch (err) {
    return error(502, 'whisper_failed', err instanceof Error ? err.message : undefined);
  }

  if (!upstream.ok) {
    return error(502, 'whisper_failed', await readUpstreamError(upstream));
  }

  const payload = await upstream.json() as OpenRouterTranscriptionResponse;
  const rawSegments = getSegments(payload, durationSec);
  const texts = rawSegments.map((seg) => (typeof seg.text === 'string' ? seg.text.trim() : '')).filter(Boolean);
  const translations = await translateSegments(texts);
  let translationIndex = 0;

  return json({
    segments: rawSegments
      .filter((seg) => typeof seg.text === 'string' && seg.text.trim().length > 0)
      .map((seg) => {
        const zh = translations[translationIndex] ?? '';
        translationIndex++;
        return {
          t: (typeof seg.start === 'number' ? seg.start : 0) + (Number.isFinite(startOffset) ? startOffset : 0),
          es: seg.text?.trim() ?? '',
          zh,
        };
      }),
  });
}
