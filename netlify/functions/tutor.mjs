// netlify/functions/tutor.mjs
export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405 });
  }

  const { OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL } = process.env;
  if (!OPENAI_API_KEY || !OPENAI_BASE_URL) {
    return new Response(JSON.stringify({ error: 'Missing OPENAI_API_KEY or OPENAI_BASE_URL' }), { status: 500 });
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const count = Math.max(1, Math.min(20, Number(payload.count) || 10));
  const types = Array.isArray(payload.types) && payload.types.length ? payload.types : ['choice','error','transform','fill','rearrange','reading'];
  const level = ['easy','normal','hard'].includes(payload.level) ? payload.level : 'normal';
  const focus = (payload.focus || '').toString();

  const systemPrompt = `
你是一名小学英语教研员，熟悉“译林版”六年级下/上册语法要求。请根据参数生成题库，并严格输出 JSON（不要多余文字）。
【目标】生成适合六年级学生的题目，覆盖：时态（一般现在/过去/进行）、主谓一致、代词（物主/反身）、形容词/副词比较级与最高级、句型转换、连词成句、短文语法选择。讲解要口语化、分步骤、举例子，解释为什么错。
【难度】
- easy：概念直给+明显提示
- normal：常规课内
- hard：选择更易混点、加干扰项
【格式】只输出 JSON：
{
  "meta": { "version": "1.0", "level": "normal|easy|hard", "types": ["choice", ...] },
  "items": [
    {
      "id": "q1",
      "type": "choice|error|transform|fill|rearrange|reading",
      "stem": "题干（中文或英文+必要上下文）",
      "options": [ { "value": "A", "text": "选项文本" }, ... ], // 非选择题可省略
      "answer": "A" | "答案文本" | ["可接受多个"],
      "explain": "分步讲解：\n1) 先看时间状语…\n2) 主语是三单…\n3) 规则/不规则变化…\n举例：This/That…",
      "hint": "给学生的小提示，可空"
    }
  ]
}
【出题参数】
- 数量: ${count}
- 题型: ${types.join(', ')}
- 难度: ${level}
- 知识点优先: "${focus}"
【约束】
- 严格可判分：选择题 answer 用 "A/B/C/D"；填空给出唯一或可接受数组；改错题提供“错因+正确句子”。
- 题干简洁，贴六年级生活语境（上学、课余、家庭、校园活动）。
- 解析要让“做错的孩子也能看懂”，避免术语堆砌，强调“如何快速判断”。
`.trim();

  const userPrompt = `
请生成 ${count} 道题。题型：${types.join(', ')}；难度：${level}；知识点优先：${focus || '无特别指定'}。
严格只返回 JSON。`.trim();

  const body = {
    model: OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  try {
    const resp = await fetch(`${OPENAI_BASE_URL.replace(/\/+$/,'')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const t = await resp.text().catch(()=> '');
      return new Response(JSON.stringify({ error: `Upstream ${resp.status}: ${t}` }), { status: 500 });
    }

    const out = await resp.json();
    const content = out?.choices?.[0]?.message?.content?.trim() || '';

    let json;
    try {
      json = JSON.parse(content);
    } catch (e) {
      const m = content.match(/```json\s*([\s\S]*?)```/i);
      if (m) {
        json = JSON.parse(m[1]);
      } else {
        throw new Error('模型未返回合法 JSON：' + e.message);
      }
    }

    if (!json || !Array.isArray(json.items)) {
      throw new Error('返回 JSON 缺少 items 数组');
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
