/**
 * Test x402 payment against TextReduce API
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmSchemeV1 } from "@x402/evm/v1";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import dotenv from "dotenv";

dotenv.config();

const API_URL = "https://api.textreduce.com/api/summarize";

async function main() {
  const privateKey = process.env.TEST_PRIVATE_KEY;
  if (!privateKey) {
    console.error("Set TEST_PRIVATE_KEY in .env");
    process.exit(1);
  }

  // Setup wallet
  const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  console.log(`Wallet: ${account.address}`);

  // Setup x402 client
  const signer = {
    address: account.address,
    signTypedData: (params) => walletClient.signTypedData(params),
  };
  const x402 = new x402Client().registerV1("base", new ExactEvmSchemeV1(signer));
  const payingFetch = wrapFetchWithPayment(fetch, x402);

  // Make paid request
  const response = await payingFetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet. Foxes are known for their cunning nature. Meanwhile, dogs are loyal companions to humans.",
      pct: 30,
    }),
  });

  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));

  if (result.payment?.transaction) {
    console.log(`\nTX: https://basescan.org/tx/${result.payment.transaction}`);
  }
}

main().catch(console.error);
