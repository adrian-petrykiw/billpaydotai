// src/config/solana.ts
import { SolanaAgentKit } from "solana-agent-kit";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";

export const initializeSolanaAgent = (
  privateKey: string,
  rpcUrl: string,
  openAiKey: string
): SolanaAgentKit => {
  return new SolanaAgentKit(privateKey, rpcUrl, openAiKey);
};

// Tool for executing payments
export const createPaymentTool = (agent: SolanaAgentKit) =>
  tool(
    async ({ recipient, amount, currency }) => {
      try {
        // Convert recipient address to PublicKey
        const recipientPubkey = new PublicKey(recipient);

        // Execute payment (implementation will vary based on currency)
        const signature = await agent.transfer(recipientPubkey, amount);

        return {
          success: true,
          signature,
          message: `Successfully transferred ${amount} ${currency} to ${recipient}`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          message: `Failed to transfer ${amount} ${currency} to ${recipient}`,
        };
      }
    },
    {
      name: "execute_payment",
      description: "Execute a payment on Solana blockchain",
      schema: z.object({
        recipient: z.string().describe("The recipient's Solana address"),
        amount: z.number().describe("The amount to transfer"),
        currency: z
          .string()
          .describe("The currency to transfer (e.g., USDC, SOL)"),
      }),
    }
  );
