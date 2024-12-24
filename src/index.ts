// src/index.ts
import express, { Request, Response } from "express";
import multer from "multer";
import { initializeSolanaAgent } from "./config/solana";
import { InvoiceProcessor } from "./services/invoice";
import { EmailService } from "./services/email";
import { TransactionGenerationChain } from "./chains/transactionGeneration";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configure environment variables
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || "";
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

// Initialize Express app
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize our services
const solanaAgent = initializeSolanaAgent(PRIVATE_KEY, RPC_URL, OPENAI_KEY);
const invoiceProcessor = new InvoiceProcessor(OPENAI_KEY);
const emailService = new EmailService();
const transactionChain = new TransactionGenerationChain(solanaAgent);

// Email endpoint to handle invoice processing
app.post(
  "/email",
  upload.single("email"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No email data provided" });
        return;
      }

      // Process the email and extract invoice
      const { invoiceText, senderEmail } =
        await emailService.processInvoiceEmail(req.file.buffer);

      // Verify sender authorization
      if (!emailService.verifyEmailAuth(senderEmail)) {
        res.status(401).json({ error: "Unauthorized sender" });
        return;
      }

      // Extract invoice data using LangChain
      const invoice = await invoiceProcessor.extractInvoiceData(invoiceText);

      // Process transaction
      const transaction = await transactionChain.processTransaction(invoice);

      // Return status to client
      res.json({
        message: "Invoice processed successfully",
        transaction,
      });
    } catch (err: any) {
      const error = err as Error;
      res.status(500).json({
        error: "Failed to process invoice",
        details: error.message,
      });
    }
  }
);

// Transaction status endpoint
app.get(
  "/transaction/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const status = await transactionChain.checkStatus(req.params.id);
      if (!status) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }
      res.json(status);
    } catch (err: any) {
      const error = err as Error;
      res.status(500).json({
        error: "Failed to fetch transaction status",
        details: error.message,
      });
    }
  }
);

// Health check endpoint
app.get("/health", (_req: Request, res: Response): void => {
  res.json({ status: "healthy" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
