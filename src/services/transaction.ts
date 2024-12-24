// src/services/transaction.ts
import { SolanaAgentKit } from "solana-agent-kit";
import { Invoice, TransactionStatus } from "../types";
import { PublicKey } from "@solana/web3.js";

export class TransactionService {
  private transactions: Map<string, TransactionStatus>;

  constructor(private agent: SolanaAgentKit) {
    this.transactions = new Map();
  }

  private async verifyAddress(address: string): Promise<boolean> {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  private async checkBalance(amount: number): Promise<boolean> {
    try {
      // Get wallet balance using agent
      const balance = await this.agent.getBalance();
      // Check if balance exists and is sufficient
      return balance !== null && balance >= amount;
    } catch {
      return false;
    }
  }

  async createTransaction(invoice: Invoice): Promise<TransactionStatus> {
    const txId = `tx_${Date.now()}`;
    const initialStatus: TransactionStatus = {
      id: txId,
      status: "pending",
      invoice,
    };

    try {
      // Validate requirements
      if (!invoice.recipientAddress) {
        throw new Error("Recipient address is required for payment");
      }

      // Verify recipient address is valid
      const isValidAddress = await this.verifyAddress(invoice.recipientAddress);
      if (!isValidAddress) {
        throw new Error("Invalid recipient address");
      }

      // Check sufficient balance
      const hasSufficientBalance = await this.checkBalance(invoice.amount);
      if (!hasSufficientBalance) {
        throw new Error("Insufficient balance");
      }

      // Store initial status
      this.transactions.set(txId, initialStatus);

      // Execute payment
      const recipientPubkey = new PublicKey(invoice.recipientAddress);
      const signature = await this.agent.transfer(
        recipientPubkey,
        invoice.amount
      );

      // Update with success
      const successStatus: TransactionStatus = {
        ...initialStatus,
        status: "completed",
        signature,
      };
      this.transactions.set(txId, successStatus);
      return successStatus;
    } catch (error: any) {
      // Update with failure
      const failureStatus: TransactionStatus = {
        ...initialStatus,
        status: "failed",
        error: error.message,
      };
      this.transactions.set(txId, failureStatus);
      return failureStatus;
    }
  }

  async getTransactionStatus(id: string): Promise<TransactionStatus | null> {
    return this.transactions.get(id) || null;
  }

  async validateTransaction(invoice: Invoice): Promise<{
    isValid: boolean;
    error?: string;
  }> {
    try {
      // Basic validation
      if (!invoice.recipientAddress) {
        return { isValid: false, error: "Recipient address is missing" };
      }

      if (!invoice.amount || invoice.amount <= 0) {
        return { isValid: false, error: "Invalid amount" };
      }

      // Address validation
      const isValidAddress = await this.verifyAddress(invoice.recipientAddress);
      if (!isValidAddress) {
        return { isValid: false, error: "Invalid recipient address format" };
      }

      // Balance check
      const hasSufficientBalance = await this.checkBalance(invoice.amount);
      if (!hasSufficientBalance) {
        return { isValid: false, error: "Insufficient balance" };
      }

      return { isValid: true };
    } catch (error: any) {
      return { isValid: false, error: error.message };
    }
  }
}
