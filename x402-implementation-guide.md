# TextReduce: x402 Payment Implementation

## What Is TextReduce?

TextReduce is a paid API for extractive text summarization deployed on Cloudflare Workers. It uses the x402 payment protocol to accept USDC micropayments on Base.

**Live API:** `https://api.textreduce.com/api/summarize`
**Price:** $0.001 USDC per request
**Network:** Base (Ethereum L2)

### What It Does

- Extracts the most information-dense sentences from text
- 100,000+ tokens/sec processing speed
- Zero hallucination (extractive, not generative)
- Preserves paragraph structure

---

## How x402 Payments Work

x402 is an open payment protocol that uses HTTP status code `402 Payment Required` to gate API access behind stablecoin payments.

### The Flow

```
┌────────┐                 ┌────────────┐                 ┌─────────────┐
│ Client │                 │ TextReduce │                 │ Facilitator │
│        │                 │ Worker     │                 │ (PayAI)     │
└───┬────┘                 └─────┬──────┘                 └──────┬──────┘
    │                            │                               │
    │  1. POST /api/summarize    │                               │
    │  (no payment)              │                               │
    │───────────────────────────>│                               │
    │                            │                               │
    │  2. 402 + payment terms    │                               │
    │<───────────────────────────│                               │
    │                            │                               │
    │  3. Sign USDC authorization│                               │
    │  (off-chain, free)         │                               │
    │                            │                               │
    │  4. POST /api/summarize    │                               │
    │  + signed payment header   │                               │
    │───────────────────────────>│                               │
    │                            │  5. Verify signature          │
    │                            │──────────────────────────────>│
    │                            │                               │
    │                            │  6. Valid ✓                   │
    │                            │<──────────────────────────────│
    │                            │                               │
    │                            │  [Process summarization]      │
    │                            │                               │
    │                            │  7. Settle payment            │
    │                            │──────────────────────────────>│
    │                            │                               │
    │                            │  8. TX hash                   │
    │                            │<──────────────────────────────│
    │                            │                               │
    │  9. 200 OK + summary       │                               │
    │<───────────────────────────│                               │
```

### Facilitators

Facilitators are services that verify payment signatures and settle transactions on-chain. They act as the bridge between off-chain signatures and on-chain USDC transfers.

**PayAI** (`https://facilitator.payai.network`) is recommended:
- No API key required
- Subsidizes gas costs (~$0.001/tx)
- Supports Base mainnet

### Who Pays What

| Party | Pays | Notes |
|-------|------|-------|
| **Buyer** | USDC (payment amount) | Signs authorization off-chain, no ETH needed |
| **Seller** | Nothing | Facilitator handles on-chain settlement |
| **Facilitator** | ETH gas (~$0.001) | Subsidized to enable the ecosystem |

---

## The Code

Two files make up the complete payment flow:

### 1. Server: `worker.js` (Cloudflare Worker)

The worker handles incoming requests and gates access behind payment.

**Key functions:**

```javascript
// Returns payment requirements when no payment provided
function buildPaymentRequired(env, requestUrl) {
  return {
    x402Version: 1,
    accepts: [{
      scheme: "exact",
      network: "base",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
      maxAmountRequired: "1000",  // $0.001 (6 decimals)
      payTo: env.X402_WALLET_ADDRESS,
      maxTimeoutSeconds: 60,
      extra: { name: "USD Coin", version: "2" }  // EIP-712 domain for USDC
    }]
  };
}
```

**Request flow:**
1. Check for `X-PAYMENT` header
2. If missing → return `402` with payment requirements
3. If present → call facilitator `/verify` endpoint
4. If valid → process request, then call `/settle` to execute payment
5. Return result with transaction hash

### 2. Client: `test-x402.js` (Payment Script)

The test script uses the `@x402/fetch` SDK to automatically handle 402 responses.

**Setup:**
```javascript
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmSchemeV1 } from "@x402/evm/v1";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Load private key from .env
const account = privateKeyToAccount(process.env.TEST_PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http("https://mainnet.base.org"),
});

// Create x402 client with EVM payment scheme
const signer = {
  address: account.address,
  signTypedData: (params) => walletClient.signTypedData(params),
};
const x402 = new x402Client().registerV1("base", new ExactEvmSchemeV1(signer));

// Wrap fetch to auto-handle payments
const payingFetch = wrapFetchWithPayment(fetch, x402);
```

**Usage:**
```javascript
// Works like normal fetch - payment handled automatically
const response = await payingFetch("https://api.textreduce.com/api/summarize", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Your text here...", pct: 30 }),
});

const result = await response.json();
// { summary: "...", stats: {...}, payment: { transaction: "0x..." } }
```

The SDK intercepts the 402 response, signs an EIP-3009 `transferWithAuthorization` for USDC, and retries with the payment header.

---

## Configuration

### Worker (`wrangler.toml`)

```toml
[vars]
X402_WALLET_ADDRESS = "0xYOUR_BASE_WALLET"
X402_FACILITATOR_URL = "https://facilitator.payai.network"
X402_PRICE_USDC = "1000"  # $0.001
```

### Client (`.env`)

```bash
TEST_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

Never commit `.env` files. The private key signs payment authorizations.

---

## Verified Transaction

```
TX: 0x9a37c3dedccd8ce1fab611974ce59abb94065b214a7057f0346401817d5a2355
https://basescan.org/tx/0x9a37c3dedccd8ce1fab611974ce59abb94065b214a7057f0346401817d5a2355

From (submitter):  0xB2Bd29925... (PayAI signer)
USDC From:         0xC309C459... (buyer)
USDC To:           0x8D09C494... (seller)
Amount:            0.001 USDC
Gas:               $0.00098 (paid by PayAI)
```

---

## Running It

**Deploy the worker:**
```bash
wrangler deploy
```

**Test a payment:**
```bash
npm install
node test-x402.js
```

Requires USDC in your wallet on Base mainnet.
