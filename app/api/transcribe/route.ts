import { verifyJWT } from '@/lib/auth';

export const maxDuration = 60;

const AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;

type WhisperSegment = {
  start?: number;
  text?: string;
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
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
            content: `将以下西语句子逐条翻译成中文，返回等长 JSON 字符串数组，不要输出任何其他内容。\n${JSON.stringify(texts)}`,
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
  const sourceLang = String(form.get('sourceLang') ?? 'es').trim() || 'es';

  const whisperForm = new FormData();
  whisperForm.set('audio', audio, audio instanceof File ? audio.name : 'chunk.webm');
  whisperForm.set('file', audio, audio instanceof File ? audio.name : 'chunk.webm');
  whisperForm.set('model', 'openai/whisper-large-v3');
  whisperForm.set('task', 'transcribe');
  whisperForm.set('language', sourceLang);
  whisperForm.set('response_format', 'verbose_json');

  const baseUrl = process.env.WHISPER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ''}`,
      },
      body: whisperForm,
      cache: 'no-store',
    });
  } catch (err) {
    return error(502, 'whisper_failed', err instanceof Error ? err.message : undefined);
  }

  if (!upstream.ok) {
    return error(502, 'whisper_failed', `Whisper status ${upstream.status}`);
  }

  const payload = await upstream.json();
  const rawSegments = Array.isArray(payload?.segments) ? payload.segments as WhisperSegment[] : [];
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
