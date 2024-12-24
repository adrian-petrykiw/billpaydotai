// src/chains/transactionGeneration.ts
import { SolanaAgentKit } from "solana-agent-kit";
import { Invoice, TransactionStatus } from "../types";
import { TransactionService } from "../services/transaction";
import { createPaymentTool } from "../config/solana";

export class TransactionGenerationChain {
  private transactionService: TransactionService;
  private paymentTool: ReturnType<typeof createPaymentTool>;

  constructor(private agent: SolanaAgentKit) {
    this.transactionService = new TransactionService(agent);
    this.paymentTool = createPaymentTool(agent);
  }

  async processTransaction(invoice: Invoice): Promise<TransactionStatus> {
    try {
      // First, validate the transaction
      const validation = await this.transactionService.validateTransaction(
        invoice
      );
      if (!validation.isValid) {
        throw new Error(validation.error || "Transaction validation failed");
      }

      // If validation passes, attempt the payment through the service
      const initialTx = await this.transactionService.createTransaction(
        invoice
      );

      if (initialTx.status === "failed") {
        // If the initial transaction failed, try using the payment tool as fallback
        const toolResult = await this.paymentTool.invoke({
          recipient: invoice.recipientAddress!,
          amount: invoice.amount,
          currency: invoice.currency,
        });

        if (!toolResult.success) {
          throw new Error(
            toolResult.error || "Payment failed in both attempts"
          );
        }

        // Return success status with tool result
        return {
          id: initialTx.id,
          status: "completed",
          invoice,
          signature: toolResult.signature,
        };
      }

      // Return the original transaction if it succeeded
      return initialTx;
    } catch (error: any) {
      // Return failure status
      return {
        id: `tx_${Date.now()}`,
        status: "failed",
        invoice,
        error: error.message,
      };
    }
  }

  async checkStatus(txId: string): Promise<TransactionStatus | null> {
    return this.transactionService.getTransactionStatus(txId);
  }
}
