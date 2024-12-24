import { SolanaAgentKit } from "solana-agent-kit";

export const initializeSolanaAgent = (
  privateKey: string,
  rpcUrl: string,
  openAiKey: string
): SolanaAgentKit => {
  return new SolanaAgentKit(privateKey, rpcUrl, openAiKey);
};
