/**
 * VoicePilot – Vercel Serverless Function: GET /api/health
 */

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

  return res.status(200).json({
    status: 'ok',
    service: 'VoicePilot Serverless AI Backend',
    version: '2.0.0',
    gemini_configured: geminiConfigured,
    openai_configured: openaiConfigured,
    anthropic_configured: anthropicConfigured,
    disclosure: 'Draft and instruction are sent only on explicit voice command.',
  });
}
