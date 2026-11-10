/**
 * AWS Lambda Proxy for DeepSeek API
 * Runtime: Node.js 24.x (ES Module)
 *
 * Security:
 * - DEEPSEEK_API_KEY is retrieved securely from Lambda Environment Variables.
 * - Authenticated with X-Extension-Token.
 * - Built-in in-memory rate limiting (30 requests/minute per IP).
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const EXPECTED_EXTENSION_TOKEN = process.env.EXTENSION_AUTH_TOKEN || 'ext-layman-98f2b4c1e0a77d56';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const ipRequestCounts = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequestCounts.entries()) {
    if (now - record.startTime > RATE_LIMIT_WINDOW_MS) {
      ipRequestCounts.delete(ip);
    }
  }
}, 30 * 1000);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Extension-Token',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};

const SYSTEM_PROMPT = `You are an intuitive Layman's Terms Explainer built into a Chrome Extension.
Whenever the user highlights text on a webpage or asks a follow-up question, your mission is to make complex, technical, or dense writing effortlessly clear and aligned with everyday human intuition.

Follow this exact structure when explaining highlighted text:
1. **Core Concept in Layman's Terms**: Explain what the text means in plain, crystal-clear, jargon-free English as if explaining it to a curious friend.
2. **Everyday Analogy**: Provide a concrete, relatable real-world comparison or metaphor that brings the concept to life.
3. **Important Background Context**: Provide the essential background information (why this matters, what led to it, or the bigger picture) so the user truly understands the highlighted text in context.
4. **Follow-Up Invitation**: Always conclude your explanation by warmly asking the user if they have any follow-up questions or if there is any specific part of the content they would like to dive deeper into.

When the user asks follow-up inquiries in the chat, continue responding like a helpful, conversational LLM while keeping every explanation grounded in layman's terms, intuitive analogies, and clear human intuition—and always invite further curiosity.`;

function checkRateLimit(clientIp) {
  const now = Date.now();
  const record = ipRequestCounts.get(clientIp);

  if (!record || (now - record.startTime > RATE_LIMIT_WINDOW_MS)) {
    ipRequestCounts.set(clientIp, { count: 1, startTime: now });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil((record.startTime + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: retryAfterSeconds };
  }

  record.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - record.count };
}

export const handler = async (event) => {
  const method = (event.requestContext?.http?.method || event.httpMethod || 'POST').toUpperCase();
  const clientIp = event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || 'unknown-client';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const path = event.rawPath || event.path || '';
  if (method === 'GET' && (path.endsWith('/health') || path.endsWith('/api/health'))) {
    const key = process.env.DEEPSEEK_API_KEY || '';
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: 'ok',
        secured: true,
        keyConfigured: Boolean(key),
        keyMasked: key ? `${key.slice(0, 6)}...${key.slice(-4)}` : null
      })
    };
  }

  const headers = event.headers || {};
  const incomingToken = headers['x-extension-token'] || headers['X-Extension-Token'] || '';

  if (incomingToken !== EXPECTED_EXTENSION_TOKEN) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Forbidden: Invalid or missing authorization token.' })
    };
  }

  const rateLimitStatus = checkRateLimit(clientIp);
  if (!rateLimitStatus.allowed) {
    return {
      statusCode: 429,
      headers: { ...CORS_HEADERS, 'Retry-After': String(rateLimitStatus.retryAfter) },
      body: JSON.stringify({ error: `Too Many Requests: Rate limit exceeded. Try again in ${rateLimitStatus.retryAfter}s.` })
    };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server configuration error: DEEPSEEK_API_KEY environment variable is missing.' })
    };
  }

  let body = {};
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf-8')
      : (event.body || '{}');
    body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch (err) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Invalid JSON payload: ${err.message}` })
    };
  }

  const { highlightedText, messages = [], model = DEFAULT_MODEL } = body;
  let conversation = [...messages];

  if (highlightedText && conversation.length === 0) {
    conversation.push({
      role: 'user',
      content: `Please explain the following highlighted text in layman's terms, give an intuitive everyday analogy, provide important background information, and ask if I have any follow-up questions:\n\n"${highlightedText}"`
    });
  }

  const hasSystemPrompt = conversation.length > 0 && conversation[0].role === 'system';
  const finalMessages = hasSystemPrompt
    ? conversation
    : [{ role: 'system', content: SYSTEM_PROMPT }, ...conversation];

  try {
    const deepseekResponse = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: finalMessages,
        temperature: 0.7,
        max_tokens: 650
      })
    });

    const data = await deepseekResponse.json();

    if (!deepseekResponse.ok) {
      return {
        statusCode: deepseekResponse.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: data.error?.message || `DeepSeek API returned HTTP ${deepseekResponse.status}` })
      };
    }

    const replyText = data.choices?.[0]?.message?.content || '';
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        reply: replyText,
        model: data.model || model,
        source: 'aws-lambda'
      })
    };
  } catch (error) {
    console.error('DeepSeek Forwarding Error:', error);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Failed to contact DeepSeek API: ${error.message}` })
    };
  }
};
