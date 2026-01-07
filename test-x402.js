/**
 * Test x402 payment flow against TextReduce API
 * Uses official @x402/fetch SDK v2
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmSchemeV1 } from "@x402/evm/v1";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import dotenv from "dotenv";

dotenv.config();

const API_URL = "https://api.textreduce.com/api/summarize";

async function main() {
  // Load private key
  const privateKey = process.env.TEST_PRIVATE_KEY;
  if (!privateKey || privateKey === "your_private_key_here") {
    console.error("❌ Set TEST_PRIVATE_KEY in .env file");
    process.exit(1);
  }

  // Setup wallet
  const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  }).extend(publicActions);

  console.log(`\n🔑 Wallet: ${account.address}`);

  // Check balances
  const ethBalance = await walletClient.getBalance({ address: account.address });
  console.log(`💰 ETH Balance: ${(Number(ethBalance) / 1e18).toFixed(6)} ETH`);

  // Check USDC balance
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const usdcBalance = await walletClient.readContract({
    address: USDC,
    abi: [{ name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`💵 USDC Balance: $${(Number(usdcBalance) / 1e6).toFixed(4)}`);

  // Create x402 client with EVM scheme for Base mainnet
  // The signer needs to have .address and .signTypedData
  const signer = {
    address: account.address,
    signTypedData: (params) => walletClient.signTypedData(params),
  };
  // Use registerV1 + ExactEvmSchemeV1 because x402.rs facilitator only supports V1
  // V1 uses simple network names like "base", not CAIP-2 format
  const x402 = new x402Client().registerV1("base", new ExactEvmSchemeV1(signer));

  // Wrap fetch with x402 payment handling
  const payingFetch = wrapFetchWithPayment(fetch, x402);

  const testPayload = {
    text: "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet. Foxes are known for their cunning nature. Meanwhile, dogs are loyal companions to humans. The relationship between dogs and humans spans thousands of years.",
    pct: 30,
  };

  console.log(`\n📡 Calling ${API_URL} with x402 payment...`);
  console.log(`📝 Input: ${testPayload.text.substring(0, 50)}...`);
  console.log(`📊 Compression: ${testPayload.pct}%\n`);

  // First, let's see what the 402 response looks like
  const testResponse = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testPayload),
  });
  console.log(`📋 Initial response status: ${testResponse.status}`);
  const paymentHeader = testResponse.headers.get("PAYMENT-REQUIRED");
  console.log(`📋 PAYMENT-REQUIRED header (first 100 chars): ${paymentHeader?.substring(0, 100)}...`);
  if (paymentHeader) {
    try {
      const decoded = JSON.parse(atob(paymentHeader));
      console.log(`📋 Decoded requirements:`, JSON.stringify(decoded, null, 2));
    } catch (e) {
      console.log(`📋 Failed to decode: ${e.message}`);
    }
  }

  try {
    const response = await payingFetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
    });

    console.log(`📥 Response Status: ${response.status}`);

    const result = await response.json();
    console.log(`\n📄 Result:`);
    console.log(JSON.stringify(result, null, 2));

    if (response.ok) {
      console.log(`\n🎉 SUCCESS! x402 payment completed!`);
      console.log(`💸 Paid $0.001 USDC to 0x8D09C494Df969eA4c8744C4Cf94A99F17314eB23`);
    }
  } catch (error) {
    console.error(`\n❌ Error:`, error.message);
    if (error.stack) console.error(error.stack);
  }
}

main().catch(console.error);
