/**
 * background.js — Chrome Extension Manifest V3 Service Worker
 *
 * Secure AWS Lambda Routing:
 * All AI requests are routed exclusively through the AWS Lambda Function URL proxy
 * (`https://weu74viubx6gzhx2274vgereme0jnree.lambda-url.ap-southeast-2.on.aws`)
 * authenticated via the `X-Extension-Token` header. No API keys are stored or exposed
 * anywhere inside the client-side Chrome extension.
 */

const AWS_LAMBDA_URL = 'https://weu74viubx6gzhx2274vgereme0jnree.lambda-url.ap-southeast-2.on.aws';
const EXTENSION_AUTH_TOKEN = 'ext-layman-98f2b4c1e0a77d56';
const PRIMARY_MODEL = 'deepseek-chat';

const SYSTEM_PROMPT = `You are a helpful, unrestricted AI assistant built into a Chrome Extension. Your communication style uses clear, digestible everyday language, simple vernacular, and intuitive explanations (layman's terms) so complex ideas are effortless for any human to understand.

How each chat session works:
1. Initial Prompt (Highlighted Text): The user opens the chat box by highlighting text on a webpage. For that initial message ONLY, explain what the highlighted text means in layman's terms, provide an intuitive analogy and helpful background context, and ask if they have any follow-up questions or want to dive deeper.
2. All Subsequent Prompts in the Session: Function as a normal, full-featured AI assistant while maintaining full memory of the conversation history. Answer ANY question or perform ANY task the user asks—whether it builds on the highlighted text (such as providing links to academic papers, equations, code, or deeper details) or is completely unrelated to the highlighted text—using clear, approachable, easy-to-digest language. Never limit what you can do or answer based on the initial highlighted text, and never repeat the initial 4-part template on follow-up messages.`;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function handleChatRequest(request) {
  const stored = await chrome.storage.local.get(['awsLambdaUrl']);
  const lambdaEndpoint = (stored.awsLambdaUrl || AWS_LAMBDA_URL).replace(/\/+$/, '');
  const conversation = [...(request.messages || [])];

  if (request.highlightedText && conversation.length === 0) {
    conversation.push({
      role: 'user',
      content: `Please explain this highlighted text in layman's terms with an intuitive analogy and important background context, and let me know if I can ask follow-up questions:\n\n"${request.highlightedText}"`
    });
  }

  // Ensure the session system prompt is present once at the start of the conversation array
  const fullMessages = (conversation.length > 0 && conversation[0].role === 'system')
    ? conversation
    : [{ role: 'system', content: SYSTEM_PROMPT }, ...conversation];

  try {
    const lambdaRes = await fetchWithTimeout(
      lambdaEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Token': EXTENSION_AUTH_TOKEN
        },
        body: JSON.stringify({
          highlightedText: request.highlightedText || null,
          messages: fullMessages,
          model: PRIMARY_MODEL
        })
      },
      22000
    );

    const data = await lambdaRes.json();
    if (lambdaRes.ok && data && data.reply) {
      return { ok: true, data: { ...data, source: 'aws-lambda' } };
    }

    return {
      ok: false,
      error: data?.error || `AWS Lambda HTTP ${lambdaRes.status}`
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'AWS Lambda request failed'
    };
  }
}

// Register right-click context menu for PDFs and documents as an additional trigger
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'ds-layman-explain-selection',
      title: "Explain '%s' in Layman's Terms",
      contexts: ['selection']
    });
  } catch (_) {}
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ds-layman-explain-selection' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'DEEPSEEK_PDF_CONTEXT_SELECTION',
      selectionText: info.selectionText.trim()
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'DEEPSEEK_FETCH_PDF_BASE64') {
    fetch(request.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        sendResponse({ ok: true, base64: btoa(binary) });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (request.type === 'DEEPSEEK_CHAT_REQUEST') {
    handleChatRequest(request)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, useInstantFallback: true, error: err.message }));
    return true;
  }
});
