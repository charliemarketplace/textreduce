# x402 Payment Protocol Implementation Guide

## Overview

x402 is an open payment protocol by Coinbase that enables instant stablecoin payments over HTTP using the `402 Payment Required` status code. Launched May 2025, with V2 released December 2025.

**Current Stats (Jan 2026):**

| Metric | 30-Day | All-Time |
|--------|--------|----------|
| Transactions | 75M+ | 100M+ |
| Volume | $24M | $600M annualized |
| Buyers | 94K | - |
| Sellers | 22K | - |

**Ecosystem:**
- Market cap: ~$928M
- Major facilitators: Coinbase, Dexter (~50% market share), PayAI, DayDreams
- Each facilitator has processed 10M+ transactions

---

## Why Base, Not ETH Mainnet

> **Important:** ETH mainnet is NOT recommended for x402. The protocol targets micropayments ($0.001-$0.10 per request), making mainnet gas costs prohibitive.

| Network | Avg Gas Cost | x402 Viable? |
|---------|--------------|--------------|
| ETH Mainnet | $2-10+ | No |
| Base | <$0.01 | Yes (recommended) |
| Solana | <$0.001 | Yes |

**Use Base for EVM payments.** It's an Ethereum L2 with:
- ~1-2 second finality
- Gas subsidized by facilitators (~$0.001/tx)
- Full EVM compatibility

---

## x402 V2 Features (Dec 2025)

### Key Upgrades

1. **Wallet-Based Sessions** - Skip repeated payments for previously purchased resources
2. **Dynamic `payTo` Routing** - Per-request recipient changes for marketplaces
3. **Discovery Extension** - Auto-indexing of API pricing/metadata
4. **Multi-Chain by Default** - CAIP standards for any chain
5. **Modular Plugin Architecture** - Add chains/schemes without SDK changes
6. **Lifecycle Hooks** - Custom logic before/after payments and settlement

### New Headers (V2)

| Header | Purpose |
|--------|---------|
| `PAYMENT-SIGNATURE` | Signed payment payload |
| `PAYMENT-REQUIRED` | Payment requirements (402 response) |
| `PAYMENT-RESPONSE` | Settlement confirmation |
| `SIGN-IN-WITH-X` | Wallet identity (CAIP-122, planned) |

---

## How It Works

```
┌────────┐                    ┌────────┐                    ┌─────────────┐
│ Client │                    │ Server │                    │ Facilitator │
└───┬────┘                    └───┬────┘                    └──────┬──────┘
    │                             │                                │
    │  1. GET /resource           │                                │
    │────────────────────────────>│                                │
    │                             │                                │
    │  2. 402 Payment Required    │                                │
    │     + PAYMENT-REQUIRED hdr  │                                │
    │<────────────────────────────│                                │
    │                             │                                │
    │  3. GET /resource           │                                │
    │     + PAYMENT-SIGNATURE hdr │                                │
    │────────────────────────────>│                                │
    │                             │  4. POST /verify               │
    │                             │───────────────────────────────>│
    │                             │                                │
    │                             │  5. Verification result        │
    │                             │<───────────────────────────────│
    │                             │                                │
    │  6. 200 OK + resource       │  7. POST /settle               │
    │<────────────────────────────│───────────────────────────────>│
    │                             │                                │
    │                             │  8. Settlement confirmation    │
    │                             │<───────────────────────────────│
    └                             └                                └
```

---

## Installation

### TypeScript/Node.js

```bash
# Minimal client (fetch-based)
npm install @x402/core @x402/evm @x402/fetch

# Express server
npm install @x402/core @x402/evm @x402/express

# Full stack with paywall UI
npm install @x402/core @x402/evm @x402/express @x402/paywall
```

### Python

```bash
pip install x402
```

### Go

```bash
go get github.com/coinbase/x402/go
```

---

## Server Implementation (Express + Base)

### Basic Setup

```typescript
import express from "express";
import { paymentMiddleware } from "@x402/express";

const app = express();

// Configure payment middleware for Base
app.use(
  paymentMiddleware({
    "GET /api/premium-data": {
      price: "$0.01",                    // Price in USD
      network: "base",                   // Base L2 (recommended for EVM)
      recipient: "0xYOUR_WALLET_ADDRESS",
      description: "Premium API access"
    },
    "POST /api/compute": {
      price: "$0.05",
      network: "base",
      recipient: "0xYOUR_WALLET_ADDRESS",
      description: "Compute endpoint"
    }
  })
);

// Your protected endpoints
app.get("/api/premium-data", (req, res) => {
  res.json({ data: "premium content" });
});

app.listen(3000);
```

### V2: Dynamic Pricing & Recipients

```typescript
app.use(
  paymentMiddleware({
    "GET /api/marketplace/:itemId": {
      price: (req) => getItemPrice(req.params.itemId),  // Dynamic pricing
      network: "base",
      recipient: (req) => getSellerAddress(req.params.itemId),  // Dynamic payTo
      description: "Marketplace item"
    }
  })
);
```

### With Facilitator Options

```typescript
app.use(
  paymentMiddleware(
    routes,
    {
      // Coinbase (default) - fee-free USDC on Base
      facilitatorUrl: "https://facilitator.cdp.coinbase.com",

      // Or use Dexter (largest facilitator by volume)
      // facilitatorUrl: "https://api.dexter.fi/x402",
    }
  )
);
```

---

## Client Implementation (Base)

### Using Fetch Wrapper (V2)

```typescript
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Setup wallet on Base
const account = privateKeyToAccount("0xYOUR_PRIVATE_KEY");
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http("https://mainnet.base.org"),
});

// Create x402 client and register EVM scheme
const client = new x402Client();
registerExactEvmScheme(client, walletClient);

// Wrap fetch to auto-handle 402 responses
const payingFetch = wrapFetchWithPayment(fetch, client);

// Use like normal fetch - payments handled automatically
const response = await payingFetch("https://api.example.com/premium-data");
const data = await response.json();
```

### Legacy/Simple Wrapper (may vary by SDK version)

```typescript
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const account = privateKeyToAccount("0xYOUR_PRIVATE_KEY");
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
});

// Simpler wrapper for older SDK versions
const payingFetch = wrapFetchWithPayment(fetch, walletClient);
```

### Using Axios

```typescript
import { wrapAxios } from "@x402/axios";
import axios from "axios";

const payingAxios = wrapAxios(axios, walletClient);

const { data } = await payingAxios.get("https://api.example.com/premium-data");
```

### V2: Session-Based Access

```typescript
import { createSessionClient } from "@x402/fetch";

// Create session-aware client (skips re-payment for purchased resources)
const sessionClient = createSessionClient(walletClient, {
  persistSessions: true,  // Remember purchased access
});

// First call pays, subsequent calls within session are free
await sessionClient.fetch("https://api.example.com/premium-data");
await sessionClient.fetch("https://api.example.com/premium-data"); // No payment
```

### Manual Payment Flow

```typescript
import { createPaymentPayload } from "@x402/core";
import { evmScheme } from "@x402/evm";

// 1. Make initial request
const response = await fetch(url);

if (response.status === 402) {
  // 2. Parse payment requirements from header
  const paymentRequired = JSON.parse(
    response.headers.get("PAYMENT-REQUIRED")
  );

  // 3. Create and sign payment
  const payment = await createPaymentPayload({
    scheme: evmScheme,
    requirements: paymentRequired,
    wallet: walletClient,
  });

  // 4. Retry with payment
  const paidResponse = await fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": JSON.stringify(payment),
    },
  });
}
```

---

## Python Implementation

### Server (FastAPI)

```python
from fastapi import FastAPI
from x402 import payment_required

app = FastAPI()

@app.get("/api/data")
@payment_required(
    price="0.01",
    network="base",  # Use Base, not mainnet
    recipient="0xYOUR_WALLET_ADDRESS"
)
async def get_data():
    return {"data": "premium content"}
```

### Client

```python
from x402 import X402Client

client = X402Client(
    private_key="0xYOUR_PRIVATE_KEY",
    network="base"  # Base L2
)

# Automatically handles 402 responses
response = client.get("https://api.example.com/api/data")
```

---

## Network Configuration

### Recommended Networks

| Network | Chain ID (CAIP-2) | Asset | Gas Cost | Recommended |
|---------|-------------------|-------|----------|-------------|
| **Base** | eip155:8453 | USDC | ~$0.001 (subsidized) | Yes - EVM |
| Solana | solana:mainnet | USDC | <$0.001 | Yes - SVM |
| Polygon | eip155:137 | USDC | ~$0.01 | Alternative |
| Avalanche | eip155:43114 | USDC | ~$0.02 | Alternative |

### Base Configuration

```typescript
import { base } from "viem/chains";

// USDC on Base
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Base RPC endpoints
const RPC_URLS = {
  primary: "https://mainnet.base.org",
  alchemy: "https://base-mainnet.g.alchemy.com/v2/YOUR_KEY",
  infura: "https://base-mainnet.infura.io/v3/YOUR_KEY",
};
```

---

## Use Cases

### 1. Pay-Per-Request API

```typescript
app.use(paymentMiddleware({
  "GET /api/ai/generate": {
    price: "$0.001",  // Micropayment per request
    network: "base",
    recipient: walletAddress,
  }
}));
```

### 2. AI Agent Payments

```typescript
// AI agent with autonomous payment capability
const agent = new AIAgent({
  wallet: agentWallet,
  fetch: wrapFetch(fetch, agentWallet),
});

// Agent can now pay for APIs automatically
await agent.callExternalAPI("https://data-provider.com/api/market-data");
```

**Major AI integrations:**
- Google Cloud Agent Payments Protocol (uses x402)
- Anthropic Claude (via Payments MCP)
- Hyperbolic (GPU inference)

### 3. Content Paywall

```typescript
app.use(paymentMiddleware({
  "GET /content/:id": {
    price: "$0.10",
    network: "base",
    recipient: contentCreatorWallet,
  }
}));
```

### 4. Tiered Pricing

```typescript
app.use(paymentMiddleware({
  "GET /api/basic": { price: "$0.001", network: "base", ... },
  "GET /api/premium": { price: "$0.01", network: "base", ... },
  "GET /api/enterprise": { price: "$0.10", network: "base", ... },
}));
```

---

## Headers Reference

### Request Headers

| Header | Description |
|--------|-------------|
| `PAYMENT-SIGNATURE` | Signed payment payload (JSON) |
| `SIGN-IN-WITH-X` | Wallet identity for sessions (V2, CAIP-122) |

### Response Headers

| Header | Description |
|--------|-------------|
| `PAYMENT-REQUIRED` | Payment requirements (on 402) |
| `PAYMENT-RESPONSE` | Settlement confirmation (on success) |

### Payment Required Schema

```json
{
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "maxAmount": "10000",
      "recipient": "0x...",
      "extra": {}
    }
  ],
  "description": "Premium API access",
  "mimeType": "application/json",
  "maxDeadlineSeconds": 60
}
```

---

## Environment Variables

```bash
# Server (Cloudflare Workers use wrangler.toml [vars] section)
X402_WALLET_ADDRESS=0x...          # Your Base wallet for receiving USDC
X402_FACILITATOR_URL=https://facilitator.payai.network
X402_PRICE_USDC=1000               # Price in USDC smallest units (1000 = $0.001)

# Client (.env file - NEVER commit this!)
TEST_PRIVATE_KEY=0x...             # Your wallet private key for signing payments
```

### Private Key Security

**Client-side (test scripts, AI agents):**
1. Create a `.env` file in your project root
2. Add your private key: `TEST_PRIVATE_KEY=0xYOUR_PRIVATE_KEY`
3. Add `.env` to `.gitignore`
4. Load with `dotenv.config()` in your code

```javascript
import dotenv from "dotenv";
dotenv.config();

const privateKey = process.env.TEST_PRIVATE_KEY;
const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
```

**Server-side (Cloudflare Workers):**
- Use `wrangler.toml` `[vars]` for non-sensitive config
- Use `wrangler secret put` for secrets
- The server does NOT need a private key - it receives payments via the facilitator

---

## Testing

### Base Sepolia Testnet

```typescript
import { baseSepolia } from "viem/chains";

const walletClient = createWalletClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});
```

### Get Testnet USDC

1. Get Base Sepolia ETH from faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
2. Get testnet USDC from Coinbase faucet

### Mock Facilitator

```typescript
// For local development
app.use(
  paymentMiddleware(routes, {
    facilitatorUrl: "http://localhost:4000/mock-facilitator",
  })
);
```

---

## Facilitators

| Facilitator | Market Share | User Fee | Gas Subsidy | Notes |
|-------------|--------------|----------|-------------|-------|
| Coinbase | ~30% | Free | Yes | Default, requires API key |
| Dexter | ~50% | Varies | Yes | Largest by volume |
| **PayAI** | ~10% | Free | Yes | **No API key required** |
| DayDreams | ~10% | Varies | Yes | - |

> Facilitators subsidize ETH gas costs (~$0.001/tx on Base). Users pay only the USDC payment amount.

### Recommended: PayAI Facilitator

For production deployments without requiring an API key, **PayAI** is the recommended facilitator:

```bash
X402_FACILITATOR_URL=https://facilitator.payai.network
```

**Why PayAI:**
- No API key required
- Has funded signers that subsidize gas costs (~$0.001/tx on Base)
- Supports both V1 and V2 protocols
- Free to use

**Check funded signers:**
```bash
curl -s "https://facilitator.payai.network/supported" | jq '.signers'
```

> **Note:** The public `x402.rs` facilitator (`facilitator.x402.rs`) can verify payments but **cannot settle** on Base mainnet because it lacks funded signer wallets. See `x402rs.md` for details.

---

## Partners & Integrations

- **Cloudflare** - x402 Foundation co-founder, native integration
- **Google Cloud** - Agent Payments Protocol uses x402
- **Anthropic** - Payments MCP for Claude
- **Hyperbolic** - AI agents paying for GPU inference
- **OpenMind** - Robots procuring compute autonomously
- **Zuplo** - API gateway with x402 support

---

## Cloudflare Workers Implementation

Cloudflare Workers provide an ideal deployment target for x402-enabled APIs due to their global edge network and low latency.

### Payment Flow (TextReduce Example)

```
┌────────┐                 ┌─────────────────┐                 ┌─────────────┐
│ Client │                 │ Cloudflare      │                 │ PayAI       │
│        │                 │ Worker          │                 │ Facilitator │
└───┬────┘                 └───────┬─────────┘                 └──────┬──────┘
    │                              │                                  │
    │  1. POST /api/summarize      │                                  │
    │  (no payment header)         │                                  │
    │─────────────────────────────>│                                  │
    │                              │                                  │
    │  2. 402 Payment Required     │                                  │
    │  + PAYMENT-REQUIRED header   │                                  │
    │  (base64 encoded)            │                                  │
    │<─────────────────────────────│                                  │
    │                              │                                  │
    │  3. POST /api/summarize      │                                  │
    │  + X-PAYMENT header          │                                  │
    │  (signed EIP-3009 payload)   │                                  │
    │─────────────────────────────>│                                  │
    │                              │  4. POST /verify                 │
    │                              │─────────────────────────────────>│
    │                              │                                  │
    │                              │  5. { isValid: true }            │
    │                              │<─────────────────────────────────│
    │                              │                                  │
    │                              │  [Process request - summarize]   │
    │                              │                                  │
    │                              │  6. POST /settle                 │
    │                              │─────────────────────────────────>│
    │                              │                                  │
    │                              │  7. { success, transaction }     │
    │                              │<─────────────────────────────────│
    │                              │                                  │
    │  8. 200 OK                   │                                  │
    │  { summary, payment: {...}}  │                                  │
    │<─────────────────────────────│                                  │
```

### Worker Configuration (wrangler.toml)

```toml
name = "your-api"
main = "worker.js"
compatibility_date = "2024-01-01"

[vars]
X402_WALLET_ADDRESS = "0xYOUR_WALLET"
X402_FACILITATOR_URL = "https://facilitator.payai.network"
X402_PRICE_USDC = "1000"  # $0.001 (6 decimals)
```

### Key Worker Functions

**1. Build Payment Requirements (V1 format):**
```javascript
function buildPaymentRequired(env, requestUrl) {
  return {
    x402Version: 1,
    accepts: [{
      scheme: "exact",
      network: "base",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
      maxAmountRequired: env.X402_PRICE_USDC,
      payTo: env.X402_WALLET_ADDRESS,
      maxTimeoutSeconds: 60,
      resource: `${new URL(requestUrl).origin}/api/endpoint`,
      description: "Your API description",
      mimeType: "application/json",
      outputSchema: {},
      extra: { name: "USD Coin", version: "2" }  // EIP-712 domain
    }]
  };
}
```

**2. Verify Payment:**
```javascript
async function verifyPayment(paymentHeader, env) {
  const paymentPayload = JSON.parse(atob(paymentHeader));
  const paymentRequirements = buildPaymentRequired(env).accepts[0];

  const response = await fetch(`${env.X402_FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements })
  });

  return (await response.json()).isValid === true;
}
```

**3. Settle Payment:**
```javascript
async function settlePayment(paymentHeader, env) {
  const paymentPayload = JSON.parse(atob(paymentHeader));
  const paymentRequirements = buildPaymentRequired(env).accepts[0];

  const response = await fetch(`${env.X402_FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements })
  });

  return response.json(); // { success, transaction, network, payer }
}
```

### Deployment

```bash
wrangler deploy
```

---

## Resources

- **Documentation**: https://docs.cdp.coinbase.com/x402/welcome
- **GitHub**: https://github.com/coinbase/x402
- **V2 Announcement**: https://www.x402.org/writing/x402-v2-launch
- **Whitepaper**: https://www.x402.org/x402-whitepaper.pdf
- **Website**: https://www.x402.org/
- **Examples**: https://github.com/coinbase/x402/tree/main/examples

---

## Quick Start Checklist

- [ ] Install SDK (`npm install @x402/express @x402/core @x402/evm`)
- [ ] Set up Base wallet address for receiving USDC payments
- [ ] Configure facilitator URL (PayAI recommended for no-API-key setup)
- [ ] Add payment middleware to protected routes
- [ ] Test with Base Sepolia testnet
- [ ] Deploy with Base mainnet configuration
- [ ] Monitor payments via block explorer or facilitator logs

> **Note:** Sellers do NOT need ETH - the facilitator pays gas for settlement.

---

## Settlement Costs on Base (Who Pays What)

Understanding the cost breakdown is critical for x402:

| Party | Pays | Notes |
|-------|------|-------|
| **Buyer** | USDC (payment amount) | Signs EIP-3009 authorization, does NOT submit tx |
| **Seller** | Nothing | Calls facilitator APIs, receives USDC |
| **Facilitator** | ETH gas (~$0.001) | Submits `transferWithAuthorization` on-chain |

### How It Works

1. **Buyer signs** an EIP-3009 `transferWithAuthorization` message (off-chain, gas-free)
2. **Facilitator receives** the signed authorization from the seller's server
3. **Facilitator submits** the transaction to USDC contract (pays ETH gas as `msg.sender`)
4. **USDC transfers** from buyer → seller on-chain

### Key Insight

**Facilitators like PayAI subsidize gas costs.** They pay ~$0.001 in ETH per settlement to make x402 frictionless. This is their business model - they eat the gas to enable the ecosystem.

**Buyers only need USDC** - no ETH required for signing authorizations.
**Sellers need nothing** - the facilitator handles settlement.

### Example Transaction

```
TX: 0x9a37c3dedccd8ce1fab611974ce59abb94065b214a7057f0346401817d5a2355

From (tx submitter):     0xB2Bd29925... (PayAI signer)
USDC From:               0xC309C459... (buyer)
USDC To:                 0x8D09C494... (seller)
Amount:                  0.001 USDC
Gas Fee:                 0.000000311 ETH ($0.00098) - paid by PayAI
```

---

## Notes

- **Use Base, not ETH mainnet** - Gas costs make mainnet impractical for micropayments
- Payments settle on Base with ~1-2 second finality
- Facilitators subsidize gas costs (PayAI pays ~$0.001/tx)
- No KYC required for buyers or sellers
- Protocol is open-source and permissionless
- V2 adds sessions, dynamic pricing, and plugin architecture
