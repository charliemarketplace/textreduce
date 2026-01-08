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
      text: `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way—in short, the period was so far like the present period, that some of its noisiest authorities insisted on its being received, for good or for evil, in the superlative degree of comparison only.

There were a king with a large jaw and a queen with a plain face, on the throne of England; there were a king with a large jaw and a queen with a fair face, on the throne of France. In both countries it was clearer than crystal to the lords of the State preserves of loaves and fishes, that things in general were settled for ever.

It was the year of Our Lord one thousand seven hundred and seventy-five. Spiritual revelations were conceded to England at that favoured period, as at this. Mrs. Southcott had recently attained her five-and-twentieth blessed birthday, of whom a prophetic private in the Life Guards had heralded the sublime appearance by announcing that arrangements were made for the swallowing up of London and Westminster. Even the Cock-lane ghost had been laid only a round dozen of years, after rapping out its messages, as the spirits of this very year last past (supernaturally deficient in originality) rapped out theirs. Mere messages in the earthly order of events had lately come to the English Crown and People, from a congress of British subjects in America: which, strange to relate, have proved more important to the human race than any communications yet received through any of the chickens of the Cock-lane brood.

France, less favoured on the whole as to matters spiritual than her sister of the shield and trident, rolled with exceeding smoothness down hill, making paper money and spending it. Under the guidance of her Christian pastors, she entertained herself, besides, with such humane achievements as sentencing a youth to have his hands cut off, his tongue torn out with pincers, and his body burned alive, because he had not kneeled down in the rain to do honour to a dirty procession of monks which passed within his view, at a distance of some fifty or sixty yards. It is likely enough that, rooted in the woods of France and Norway, there were growing trees, when that sufferer was put to death, already marked by the Woodman, Fate, to come down and be sawn into boards, to make a certain movable framework with a sack and a knife in it, terrible in history.`,
      pct: 5,
    }),
  });

  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));

  if (result.payment?.transaction) {
    console.log(`\nTX: https://basescan.org/tx/${result.payment.transaction}`);
  }
}

main().catch(console.error);
