/**
 * VoicePilot – Vercel Serverless Function: POST /api/edit
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { draft, instruction } = req.body || {};
  const draftText = typeof draft === 'string' ? draft : '';
  const instrText = typeof instruction === 'string' ? instruction.trim() : '';

  if (!instrText) {
    return res.status(400).json({ error: 'No editing instruction provided.' });
  }

  if (draftText.length > 50000) {
    return res.status(413).json({ error: 'Draft exceeds payload limit of 50,000 characters.' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    return res.status(503).json({
      error: 'No AI provider key configured on server. Please add GEMINI_API_KEY or OPENAI_API_KEY in Vercel Environment Variables.'
    });
  }

  const systemPrompt = (
    "You are an expert writing assistant in the VoicePilot editor. The user provides a draft text and an editing instruction. " +
    "Return ONLY the final revised draft text. Do NOT include any commentary, explanations, greetings, quotes, or markdown wrappers. " +
    "Preserve the author's original voice, style, and intent. If the instruction is unclear, return the original draft unchanged."
  );

  // 1. Try Google Gemini
  if (geminiKey) {
    const candidateModels = [
      process.env.VOICEPILOT_GEMINI_MODEL || 'gemini-1.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-pro'
    ];
    let lastErr = null;

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const userPrompt = `Draft:\n${draftText.slice(0, 12000)}\n\nInstruction: "${instrText}"`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4096,
            }
          })
        });

        if (resp.status === 404) {
          lastErr = new Error(`Model ${model} not found`);
          continue;
        }

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Gemini returned HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (rawText) {
          return res.status(200).json({
            result: rawText,
            reason: `Applied: ${instrText}`
          });
        }
      } catch (err) {
        lastErr = err;
      }
    }

    if (!openaiKey) {
      return res.status(503).json({ error: `Gemini edit failed: ${lastErr?.message || 'Unknown error'}` });
    }
  }

  // 2. Try OpenAI
  if (openaiKey) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: process.env.VOICEPILOT_OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Draft:\n${draftText.slice(0, 12000)}\n\nInstruction: "${instrText}"` }
          ],
          temperature: 0.2,
          max_tokens: 4096
        })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error?.message || `OpenAI HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const rawText = data.choices?.[0]?.message?.content?.trim() || '';
      return res.status(200).json({
        result: rawText,
        reason: `Applied: ${instrText}`
      });
    } catch (err) {
      return res.status(503).json({ error: `OpenAI edit failed: ${err.message}` });
    }
  }

  return res.status(503).json({ error: 'No available AI provider succeeded.' });
}
