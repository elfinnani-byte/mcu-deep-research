// 방문자 키 보관 — **이 브라우저에만** 둔다.
//
// 예전에는 이 옆에 llm.js 가 있어서 브라우저가 OpenAI 를 직접 불렀다.
// 그러려면 파이프라인을 자바스크립트로 한 벌 더 만들어야 했고, 프롬프트를 고칠 때마다
// 파이썬과 두 군데를 똑같이 손봐야 했다. 지금은 파이프라인이 파이썬 하나뿐이고
// 브라우저는 /api/plan · /api/run 을 부른다. 그래서 여기 남은 것은 **키 보관뿐**이다.
//
// 키는 요청 본문으로만 나간다. 우리 서버는 그것을 파일·로그·응답 어디에도 쓰지 않는다.

const KEY = 'mrd.openai.key';

export const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setKey = k => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} };
export const hasKey = () => /^sk-/.test(getKey());
