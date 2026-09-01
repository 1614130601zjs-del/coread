function pick(name, fallback = '') {
  return process.env[name] || fallback;
}

export function modelConfig(kind = 'main') {
  const prefix = kind === 'helper' ? 'COREAD_HELPER' : 'COREAD_MAIN';
  const baseUrl = pick(`${prefix}_BASE_URL`, pick('COREAD_API_BASE_URL'));
  const apiKey = pick(`${prefix}_API_KEY`, pick('COREAD_API_KEY'));
  const model = pick(`${prefix}_MODEL`, '');
  const fallback = pick(`${prefix}_FALLBACK_MODEL`, '');
  const fallbacks = fallback.split(',').map(value => value.trim()).filter(value => value && value !== model);
  return { kind, baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model, fallbacks };
}

export function configuredModel(kind = 'main') {
  const c = modelConfig(kind);
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

async function requestModel(config, messages, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.35,
        max_tokens: options.maxTokens || 2000,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!response.ok) {
      const error = new Error(`model ${response.status}: ${data?.error?.message || raw.slice(0, 300)}`);
      error.status = response.status;
      throw error;
    }
    const text = data?.choices?.[0]?.message?.content || '';
    const promptTokens = Number(data?.usage?.prompt_tokens);
    const completionTokens = Number(data?.usage?.completion_tokens);
    const actualUsage = Number.isFinite(promptTokens) && Number.isFinite(completionTokens);
    const inputText = messages.map(message => {
      const content = message?.content;
      return typeof content === 'string' ? content : JSON.stringify(content || '');
    }).join('\n');
    return {
      text,
      usage: actualUsage
        ? { input_tokens: promptTokens, output_tokens: completionTokens, estimated: false }
        : {
          input_tokens: Math.max(1, Math.ceil(inputText.length / 1.5)),
          output_tokens: Math.max(1, Math.ceil(String(text).length / 1.5)),
          estimated: true,
        },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callModel(kind, messages, options = {}) {
  const config = modelConfig(kind);
  if (!config.baseUrl || !config.apiKey) throw new Error(`${kind} model is not configured`);
  const candidates = [config.model, ...config.fallbacks];
  const errors = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    try {
      const response = await requestModel({ ...config, model }, messages, options);
      return {
        text: response.text,
        model,
        source: index === 0 ? kind : `${kind}:fallback`,
        usage: response.usage,
      };
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
    }
  }
  throw new Error(`all ${kind} model candidates failed; ${errors.join(' | ')}`);
}

export function parseJsonObject(text) {
  const clean = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(clean); } catch {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export function safeModelConfigSummary() {
  return ['main', 'helper'].map(kind => {
    const c = modelConfig(kind);
    return { kind, configured: Boolean(c.baseUrl && c.apiKey), model: c.model, fallback: c.fallbacks.length ? c.fallbacks : null, base_url: c.baseUrl || null };
  });
}
