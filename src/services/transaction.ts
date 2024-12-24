import { SolanaAgentKit } from "solana-agent-kit";
import { Invoice, TransactionStatus } from "../types";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SendOptions,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  getVaultPda,
  instructions,
  accounts,
  getTransactionPda,
  PROGRAM_ID,
} from "@sqds/multisig";

import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createTransferInstruction,
} from "@solana/spl-token";
import { transactionMessageToVaultMessage } from "./squads";

interface TransactionValidation {
  isValid: boolean;
  error?: string;
}

export class TransactionService {
  private transactions: Map<string, TransactionStatus>;
  private heliusConnection: Connection;
  private USDC_MINT: PublicKey;

  constructor(private agent: SolanaAgentKit, private apiUser: any) {
    this.transactions = new Map();
    this.heliusConnection = new Connection(
      process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com"
    );
    this.USDC_MINT = new PublicKey(
      process.env.USDC_MINT_ADDRESS ||
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
  }

  private async verifyAddress(address: string): Promise<boolean> {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  private async checkBalance(
    amount: number,
    tokenMint?: PublicKey
  ): Promise<boolean> {
    try {
      if (tokenMint) {
        const ata = await getAssociatedTokenAddress(
          tokenMint,
          this.agent.wallet_address,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const balance = await this.heliusConnection.getTokenAccountBalance(ata);
        return (balance.value.uiAmount ?? 0) >= amount;
      }

      const balance = await this.agent.getBalance();
      if (balance === null) return false;
      return balance >= amount;
    } catch (error) {
      console.error("Error checking balance:", error);
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
      const validation = await this.validateTransaction(invoice);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      this.transactions.set(txId, initialStatus);

      const recipientPubkey = new PublicKey(invoice.recipientAddress!);
      const userMultisig = await this.getUserMultisig();

      if (userMultisig) {
        return this.createMultisigTransaction(invoice, userMultisig);
      }

      const signature = await this.agent.transfer(
        recipientPubkey,
        invoice.amount
      );

      const successStatus: TransactionStatus = {
        ...initialStatus,
        status: "completed",
        signature,
      };
      this.transactions.set(txId, successStatus);
      return successStatus;
    } catch (error: any) {
      const failureStatus: TransactionStatus = {
        ...initialStatus,
        status: "failed",
        error: error.message,
      };
      this.transactions.set(txId, failureStatus);
      return failureStatus;
    }
  }

  private async getUserMultisig(): Promise<PublicKey | null> {
    try {
      const multisigAddress = this.apiUser?.organization?.multisig_wallet;
      return multisigAddress ? new PublicKey(multisigAddress) : null;
    } catch {
      return null;
    }
  }

  async createMultisigTransaction(
    invoice: Invoice,
    senderMultisigPda: PublicKey
  ): Promise<TransactionStatus> {
    const txId = `tx_${Date.now()}`;

    try {
      // Get sender's multisig info
      const senderMultisigInfo = await accounts.Multisig.fromAccountAddress(
        this.heliusConnection,
        senderMultisigPda
      );

      // Get vault PDA
      const [senderVaultPda] = getVaultPda({
        multisigPda: senderMultisigPda,
        index: 0,
      });

      // Get USDC ATAs
      const senderUsdcAta = await getAssociatedTokenAddress(
        this.USDC_MINT,
        senderVaultPda,
        true
      );

      const recipientPubkey = new PublicKey(invoice.recipientAddress!);
      const recipientUsdcAta = await getAssociatedTokenAddress(
        this.USDC_MINT,
        recipientPubkey,
        true
      );

      // Create transfer instruction for USDC
      const transferIx = createTransferInstruction(
        senderUsdcAta,
        recipientUsdcAta,
        senderVaultPda,
        BigInt(Math.round(invoice.amount * 1e6)) // Convert to USDC decimals
      );

      // Create transaction message
      const transferMessage = new TransactionMessage({
        payerKey: senderVaultPda,
        recentBlockhash: (await this.heliusConnection.getLatestBlockhash())
          .blockhash,
        instructions: [transferIx],
      });

      // Convert to vault message
      const compiledMessage = transactionMessageToVaultMessage(
        transferMessage,
        [],
        senderVaultPda
      );

      // Handle transaction index conversion
      const currentIndex = senderMultisigInfo.transactionIndex;
      const nextIndex = currentIndex.toString();
      const newTransactionIndex = BigInt(parseInt(nextIndex) + 1);

      // Get transaction PDA
      const [transactionPda] = getTransactionPda({
        multisigPda: senderMultisigPda,
        index: newTransactionIndex,
      });

      // Get execution accounts
      const { accountMetas } = await getAccountsForExecuteCore(
        this.heliusConnection,
        senderMultisigPda,
        compiledMessage,
        [0],
        0,
        transactionPda,
        PROGRAM_ID
      );

      // Create the transaction
      const createIx = instructions.vaultTransactionCreate({
        multisigPda: senderMultisigPda,
        transactionIndex: newTransactionIndex,
        creator: this.agent.wallet_address,
        vaultIndex: 0,
        ephemeralSigners: 0,
        transactionMessage: transferMessage,
        memo: `Invoice-${invoice.invoiceNumber}`,
      });

      // Create and approve proposal
      const proposeIx = instructions.proposalCreate({
        multisigPda: senderMultisigPda,
        transactionIndex: newTransactionIndex,
        creator: this.agent.wallet_address,
      });

      const approveIx = instructions.proposalApprove({
        multisigPda: senderMultisigPda,
        transactionIndex: newTransactionIndex,
        member: this.agent.wallet_address,
      });

      // Execute transaction
      const { instruction: executeIx } = vaultTransactionExecuteSync({
        multisigPda: senderMultisigPda,
        transactionIndex: newTransactionIndex,
        member: this.agent.wallet_address,
        accountsForExecute: accountMetas,
        programId: PROGRAM_ID,
      });

      // Combine all instructions
      const transaction = new Transaction().add(
        createIx,
        proposeIx,
        approveIx,
        executeIx
      );

      // Send with retry logic
      const signature = await this.sendWithRetry(transaction);

      return {
        id: txId,
        status: "completed",
        invoice,
        signature,
      };
    } catch (error: any) {
      console.error("Failed to create multisig transaction:", error);
      return {
        id: txId,
        status: "failed",
        invoice,
        error: error.message,
      };
    }
  }

  private async sendWithRetry(
    transaction: Transaction,
    maxRetries = 3,
    options?: SendOptions
  ): Promise<string> {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const signature = await this.agent.sendAndConfirmTransaction(
          transaction,
          options
        );
        return signature;
      } catch (error: any) {
        console.error(`Attempt ${attempt + 1} failed:`, error);
        lastError = error;
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1))
        );
      }
    }
    throw lastError;
  }

  async getTransactionStatus(id: string): Promise<TransactionStatus | null> {
    return this.transactions.get(id) || null;
  }

  async validateTransaction(invoice: Invoice): Promise<TransactionValidation> {
    try {
      if (!invoice.recipientAddress) {
        return { isValid: false, error: "Recipient address is missing" };
      }

      if (!invoice.amount || invoice.amount <= 0) {
        return { isValid: false, error: "Invalid amount" };
      }

      const isValidAddress = await this.verifyAddress(invoice.recipientAddress);
      if (!isValidAddress) {
        return { isValid: false, error: "Invalid recipient address format" };
      }

      const hasSufficientBalance = await this.checkBalance(
        invoice.amount,
        this.USDC_MINT
      );
      if (!hasSufficientBalance) {
        return { isValid: false, error: "Insufficient balance" };
      }

      return { isValid: true };
    } catch (error: any) {
      return { isValid: false, error: error.message };
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.heliusConnection.getLatestBlockhash();
      return true;
    } catch (error) {
      console.error("Transaction service health check failed:", error);
      return false;
    }
  }

  async getTransactionHistory(
    limit: number = 10,
    offset: number = 0
  ): Promise<TransactionStatus[]> {
    // Convert the transactions Map to an array
    const allTransactions = Array.from(this.transactions.values());

    // Sort by most recent first (using ID which contains timestamp)
    const sortedTransactions = allTransactions.sort((a, b) => {
      const aTime = parseInt(a.id.split("_")[1]);
      const bTime = parseInt(b.id.split("_")[1]);
      return bTime - aTime;
    });

    // Apply pagination
    return sortedTransactions.slice(offset, offset + limit);
  }
}
