import { verifyJWT } from '@/lib/auth';

export const maxDuration = 60;

const AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;

type WhisperSegment = {
  start?: number;
  text?: string;
};

type OpenRouterTranscriptionResponse = {
  text?: string;
  segments?: WhisperSegment[];
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

async function readUpstreamError(res: Response) {
  const text = await res.text().catch(() => '');
  return text ? `Whisper status ${res.status}: ${text.slice(0, 1000)}` : `Whisper status ${res.status}`;
}

function getSegments(payload: OpenRouterTranscriptionResponse): WhisperSegment[] {
  if (Array.isArray(payload.segments)) return payload.segments;

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  return text ? [{ start: 0, text }] : [];
}

async function translateSegments(texts: string[]) {
  if (texts.length === 0) return [];

  const baseUrl = process.env.ANALYSIS_BASE_URL;
  const apiKey = process.env.ANALYSIS_API_KEY;
  const model = process.env.ANALYSIS_MODEL ?? 'claude-sonnet-4-6';

  async function once() {
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
          {
            role: 'user',
            content: `将以下句子逐条翻译成中文，返回等长 JSON 字符串数组，不要输出任何其他内容。\n${JSON.stringify(texts)}`,
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
      throw new Error('missing translation content');
    }

    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error('translation response is not an array');
    }
    return parsed.map((item) => (typeof item === 'string' ? item : ''));
  }

  try {
    return await once();
  } catch {
    try {
      return await once();
    } catch {
      return texts.map(() => '');
    }
  }
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

  const baseUrl = process.env.WHISPER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  let upstream: Response;
  try {
    const apiKey = getRequiredEnv('OPENROUTER_API_KEY');
    const whisperForm = new FormData();
    whisperForm.append('file', audio, `audio.${getAudioFormat(audio)}`);
    whisperForm.append('model', process.env.WHISPER_MODEL ?? 'openai/whisper-large-v3-turbo');
    whisperForm.append('response_format', 'verbose_json');
    whisperForm.append('timestamp_granularities[]', 'segment');
    upstream = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: whisperForm,
      cache: 'no-store',
    });
  } catch (err) {
    return error(502, 'whisper_failed', err instanceof Error ? err.message : undefined);
  }

  if (!upstream.ok) {
    return error(502, 'whisper_failed', await readUpstreamError(upstream));
  }

  const payload = await upstream.json() as OpenRouterTranscriptionResponse;
  const rawSegments = getSegments(payload);
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
