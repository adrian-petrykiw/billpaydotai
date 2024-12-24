import { SolanaAgentKit } from "solana-agent-kit";
import { Invoice, TransactionStatus } from "../types";
import { InvoiceProcessor } from "../services/invoice";

export class InvoiceProcessingChain {
  constructor(
    private agent: SolanaAgentKit,
    private processor: InvoiceProcessor
  ) {}

  async processInvoice(pdfText: string): Promise<TransactionStatus> {
    try {
      // Extract invoice data
      const invoice = await this.processor.extractInvoiceData(pdfText);

      // Validate invoice
      const isValid = await this.processor.validateInvoice(invoice);
      if (!isValid) {
        throw new Error("Invalid invoice data");
      }

      // Create initial transaction status
      const txStatus: TransactionStatus = {
        id: `tx_${Date.now()}`,
        status: "pending",
        invoice,
      };

      // Process payment using Solana Agent Kit
      // Will implement actual payment logic in next iteration

      return txStatus;
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      throw new Error(`Invoice processing failed: ${errorMessage}`);
    }
  }
}
