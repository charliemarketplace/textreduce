/**
 * TextReduce - x402-enabled text summarization
 * Cloudflare Workers implementation
 */

// USDC contract on Base
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ============================================
// SUMMARIZATION LOGIC
// ============================================

function escapeAbbreviations(text) {
  return text
    .replace(/\be\.g\./gi, "EG_ABBR")
    .replace(/\bi\.e\./gi, "IE_ABBR")
    .replace(/\betc\./gi, "ETC_ABBR")
    .replace(/\bvs\./gi, "VS_ABBR")
    .replace(/\bdr\./gi, "DR_ABBR")
    .replace(/\bmr\./gi, "MR_ABBR")
    .replace(/\bmrs\./gi, "MRS_ABBR")
    .replace(/\bms\./gi, "MS_ABBR");
}

function restoreAbbreviations(text) {
  return text
    .replace(/EG_ABBR/g, "e.g.")
    .replace(/IE_ABBR/g, "i.e.")
    .replace(/ETC_ABBR/g, "etc.")
    .replace(/VS_ABBR/g, "vs.")
    .replace(/DR_ABBR/g, "Dr.")
    .replace(/MR_ABBR/g, "Mr.")
    .replace(/MRS_ABBR/g, "Mrs.")
    .replace(/MS_ABBR/g, "Ms.");
}

function getSentencesWithParagraphs(text) {
  const paragraphs = text.split(/\n\s*\n+/);
  const sentences = [];
  paragraphs.forEach((para, paraIndex) => {
    const escaped = escapeAbbreviations(para);
    const parts = escaped.split(/[.?!;]\s+|[.?!;]$|—|–/);
    parts.forEach((s) => {
      const cleaned = restoreAbbreviations(s).trim();
      if (cleaned.length > 0) {
        sentences.push({ text: cleaned, paragraphIndex: paraIndex });
      }
    });
  });
  return sentences;
}

function getWords(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w.length > 0);
}

function getWordFrequencies(words) {
  const freq = {};
  words.forEach((w) => (freq[w] = (freq[w] || 0) + 1));
  const total = words.length;
  Object.keys(freq).forEach((w) => (freq[w] = freq[w] / total));
  return freq;
}

function scoreSentence(sentence, wordFreq) {
  return getWords(sentence).reduce((sum, w) => sum + (wordFreq[w] || 0), 0);
}

function summarize(text, keepPct) {
  if (!text?.trim()) return { summary: "", kept: 0, total: 0 };

  const sentences = getSentencesWithParagraphs(text);
  const wordFreq = getWordFrequencies(getWords(text));

  const scored = sentences.map((s, i) => ({
    text: s.text,
    index: i,
    paragraphIndex: s.paragraphIndex,
    score: scoreSentence(s.text, wordFreq),
  }));

  const scores = scored.map((s) => s.score).sort((a, b) => a - b);
  const threshold = scores[Math.floor(scores.length * (1 - keepPct))] || 0;

  const kept = scored.filter((s) => s.score >= threshold).sort((a, b) => a.index - b.index);

  const paragraphs = {};
  kept.forEach((s) => {
    if (!paragraphs[s.paragraphIndex]) paragraphs[s.paragraphIndex] = [];
    paragraphs[s.paragraphIndex].push(s.text);
  });

  const summary = Object.keys(paragraphs)
    .sort((a, b) => a - b)
    .map((pIdx) => paragraphs[pIdx].join(". ") + ".")
    .join("\n\n");

  return { summary, kept: kept.length, total: sentences.length };
}

// ============================================
// x402 PAYMENT HANDLING
// ============================================

function buildPaymentRequired(env, requestUrl) {
  // x402 V1 format: x402.rs only supports V1!
  const baseUrl = new URL(requestUrl).origin;
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "base", // x402.rs V1 uses simple network names
        asset: USDC_BASE,
        maxAmountRequired: env.X402_PRICE_USDC,
        payTo: env.X402_WALLET_ADDRESS,
        maxTimeoutSeconds: 60,
        resource: `${baseUrl}/api/summarize`,
        description: "TextReduce: 100k+ tokens/sec. Zero hallucination.",
        mimeType: "application/json",
        outputSchema: {},
        extra: {
          name: "USD Coin",  // EIP-712 domain name for USDC
          version: "2"       // EIP-712 domain version for USDC
        }
      },
    ],
  };
}

// Base64 encode for x402 header (SDK expects base64)
function encodePaymentRequired(obj) {
  return btoa(JSON.stringify(obj));
}

async function verifyPayment(paymentHeader, env, requestUrl) {
  try {
    // Decode payment - SDK sends base64 encoded
    let paymentPayload;
    try {
      paymentPayload = JSON.parse(atob(paymentHeader));
    } catch {
      paymentPayload = JSON.parse(paymentHeader);
    }

    // V2: paymentRequirements is just the accepts[0] terms
    const paymentRequirements = buildPaymentRequired(env, requestUrl).accepts[0];

    // V1: facilitator expects x402Version at top level for verify
    const requestBody = { x402Version: 1, paymentPayload, paymentRequirements };
    console.log(`[x402] Calling ${env.X402_FACILITATOR_URL}/verify`);
    console.log(`[x402] Request body: ${JSON.stringify(requestBody, null, 2)}`);

    const response = await fetch(`${env.X402_FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    console.log(`[x402] Response status: ${response.status}`);
    console.log(`[x402] Response body: ${responseText}`);

    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}`, response: responseText };
    }

    const result = JSON.parse(responseText);
    if (result.isValid === true) {
      return { valid: true };
    }
    return { valid: false, error: result.invalidReason || "Unknown", response: responseText };
  } catch (e) {
    console.log(`[x402] Verify error: ${e.message}`);
    return { valid: false, error: e.message };
  }
}

async function settlePayment(paymentHeader, env, requestUrl) {
  try {
    let paymentPayload;
    try {
      paymentPayload = JSON.parse(atob(paymentHeader));
    } catch {
      paymentPayload = JSON.parse(paymentHeader);
    }
    const paymentRequirements = buildPaymentRequired(env, requestUrl).accepts[0];
    // x402.rs expects x402Version at top level
    const settleBody = { x402Version: 1, paymentPayload, paymentRequirements };
    console.log(`[x402] Settle request:`, JSON.stringify(settleBody, null, 2));
    const response = await fetch(`${env.X402_FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settleBody),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[x402] Settlement result:`, JSON.stringify(result));
      return result; // { success, transaction, network, payer }
    }
    const errorText = await response.text();
    console.log(`[x402] Settlement failed:`, errorText);
    return { success: false, error: errorText };
  } catch (e) {
    console.log(`[x402] Settlement error:`, e.message);
    return { success: false, error: e.message };
  }
}

// ============================================
// REQUEST HANDLERS
// ============================================

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers },
  });
}

async function handleSummarize(request, env) {
  // Check for x402 payment - SDK may use different header names
  const paymentHeader = request.headers.get("X-PAYMENT")
    || request.headers.get("PAYMENT-SIGNATURE")
    || request.headers.get("x-payment")
    || request.headers.get("X-Payment");

  // Debug: log all headers
  console.log("Received headers:", [...request.headers.entries()].map(([k,v]) => `${k}: ${v.substring(0,50)}`).join(", "));

  if (!paymentHeader) {
    // No payment - return 402 with base64-encoded header (x402 SDK requirement)
    const paymentRequired = buildPaymentRequired(env, request.url);
    return json(paymentRequired, 402, {
      "PAYMENT-REQUIRED": encodePaymentRequired(paymentRequired),
    });
  }

  // Verify payment with facilitator
  const verifyResult = await verifyPayment(paymentHeader, env, request.url);
  if (!verifyResult.valid) {
    return json({
      error: "Payment verification failed",
      facilitatorError: verifyResult.error,
      facilitatorResponse: verifyResult.response
    }, 402);
  }

  // Parse request
  let text, pct;
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    text = body.text;
    pct = body.pct ?? 30;
  } else {
    const url = new URL(request.url);
    text = url.searchParams.get("text");
    pct = parseInt(url.searchParams.get("pct")) || 30;
  }

  if (!text) {
    return json({ error: "Missing required field: text" }, 400);
  }

  // Summarize
  const keepPct = Math.min(100, Math.max(0, pct)) / 100;
  const result = summarize(text, keepPct);

  // Settle payment and get transaction hash
  const settlement = await settlePayment(paymentHeader, env, request.url);

  return json({
    summary: result.summary,
    stats: {
      sentencesKept: result.kept,
      sentencesTotal: result.total,
      compressionRatio: result.total > 0 ? Math.round((result.kept / result.total) * 100) : 0,
    },
    payment: settlement,  // Return full settlement response for debugging
  });
}

function handleX402Manifest(env) {
  return json({
    version: "1.0",
    name: "TextReduce",
    description: "100,000+ tokens/sec extractive summarization. Zero hallucination. Up to 99% reduction to only the most information-dense sentences.",
    homepage: "https://textreduce.com",
    features: [
      "100,000+ tokens per second",
      "Zero hallucination - extractive, not generative",
      "Paragraph-preserving extraction",
      "Up to 99% reduction to most information-dense sentences",
    ],
    resources: [
      {
        path: "/api/summarize",
        methods: ["GET", "POST"],
        description: "Extractive summarization. Returns only the most information-dense sentences. Zero hallucination - never generates, only extracts.",
        accepts: [
          {
            scheme: "exact",
            maxAmountRequired: env.X402_PRICE_USDC,
            network: env.X402_NETWORK,
            payTo: env.X402_WALLET_ADDRESS,
            asset: USDC_BASE,
          },
        ],
        mimeType: "application/json",
        tags: ["summarization", "nlp", "text-processing", "ai-agents", "extractive", "no-hallucination"],
        input: {
          contentType: "application/json",
          schema: {
            type: "object",
            required: ["text"],
            properties: {
              text: {
                type: "string",
                description: "The text to summarize",
              },
              pct: {
                type: "integer",
                minimum: 0,
                maximum: 100,
                default: 50,
                description: "Percentage of sentences to keep (0-100). Lower = more reduction.",
              },
            },
          },
          examples: [
            {
              text: "Your long document text here...",
              pct: 30,
            },
          ],
        },
        output: {
          schema: {
            type: "object",
            properties: {
              summary: { type: "string", description: "The reduced text" },
              stats: {
                type: "object",
                properties: {
                  sentencesKept: { type: "integer" },
                  sentencesTotal: { type: "integer" },
                  compressionRatio: { type: "integer" },
                },
              },
            },
          },
        },
      },
    ],
    pricing: { model: "per-request", amount: "$0.001", currency: "USDC" },
  });
}

function handleApiDocs(env) {
  return json({
    name: "TextReduce API",
    tagline: "100,000+ tokens/sec. Zero hallucination. Up to 99% reduction.",
    version: "1.0.0",
    features: [
      "100,000+ tokens per second",
      "Zero hallucination - extractive only, never generates",
      "Paragraph-preserving extraction",
      "Up to 99% reduction to most information-dense sentences",
    ],
    pricing: "$0.001 USDC per request",
    network: env.X402_NETWORK,
    endpoints: {
      "POST /api/summarize": { body: { text: "string", pct: "0-100" }, payment: "x402" },
      "GET /api/summarize": { params: "?text=...&pct=50", payment: "x402" },
      "GET /.well-known/x402.json": { payment: "free" },
    },
  });
}

// ============================================
// MAIN ROUTER
// ============================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, PAYMENT-SIGNATURE",
        },
      });
    }

    // Routes
    if (path === "/.well-known/x402.json") return handleX402Manifest(env);
    if (path === "/api" || path === "/api/") return handleApiDocs(env);
    if (path === "/api/summarize") return handleSummarize(request, env);

    // Redirect root to main site, 404 everything else
    if (path === "/" || path === "/index.html") {
      return Response.redirect("https://textreduce.com", 302);
    }

    return json({ error: "Not found" }, 404);
  },
};
