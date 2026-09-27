// 브라우저에서 OpenAI 를 직접 부른다. 서버가 없으므로 키는 방문자 것이고,
// 이 브라우저(localStorage)에만 저장되며 OpenAI 외 어디로도 가지 않는다.

const KEY = 'mrd.openai.key';
export const MODEL = 'gpt-4o-mini';
export const CAP = 60000;                 // 한 번에 모델에 넣는 최대 글자 수 (파이썬과 동일)

export const COST = { calls: 0, sub: 0, coord: 0 };
export const resetCost = () => { COST.calls = 0; COST.sub = 0; COST.coord = 0; };

export const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setKey = k => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} };
export const hasKey = () => /^sk-/.test(getKey());

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function ask(system, user, { coord = false, cap = CAP, signal } = {}) {
  const body = String(user).slice(0, cap);
  COST.calls++; COST[coord ? 'coord' : 'sub'] += body.length;

  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getKey()}` },
        body: JSON.stringify({
          model: MODEL, temperature: 0,
          messages: [{ role: 'system', content: system }, { role: 'user', content: body }],
        }),
      });
    } catch (e) {
      if (attempt === 2) throw new Error('네트워크 오류 — ' + e.message);
      await sleep(2 ** attempt * 1000); continue;
    }
    if (res.ok) return (await res.json()).choices[0].message.content ?? '';

    const t = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('API 키가 거부되었습니다 (401). 키를 확인하세요.');
    if (res.status === 400 && /model/i.test(t)) throw new Error('모델을 쓸 수 없습니다 — ' + t.slice(0, 120));
    // 429·5xx 는 잠깐뿐인 오류로 보고 재시도한다
    if (attempt === 2 || ![429, 500, 502, 503, 529].includes(res.status)) {
      throw new Error(`OpenAI 오류 ${res.status} — ${t.slice(0, 160)}`);
    }
    await sleep(2 ** attempt * 1000);
  }
}

// JSON 만 받기로 했는데 모델이 말을 덧붙이는 일이 있다 — 대괄호/중괄호만 떼어 낸다
export function jload(raw, fallback) {
  try {
    const m = String(raw).match(Array.isArray(fallback) ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
    return JSON.parse(m[0]);
  } catch { return fallback; }
}
