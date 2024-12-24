import { SolanaAgentKit } from "solana-agent-kit";

export class EnhancedSolanaAgent extends SolanaAgentKit {
  async checkHealth(): Promise<boolean> {
    try {
      // Try to get a recent blockhash to verify connection
      const balance = await this.getBalance();
      return balance !== null;
    } catch (error) {
      console.error("Solana health check failed:", error);
      return false;
    }
  }
}
