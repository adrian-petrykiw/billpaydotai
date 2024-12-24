import express, { Request, Response } from "express";
import multer from "multer";
import { initializeSolanaAgent } from "./config/solana";
import { InvoiceProcessor } from "./services/invoice";
import { GmailWatchService } from "./services/gmail";
import { TransactionService } from "./services/transaction";
import dotenv from "dotenv";
import { CustomError } from "./types/errors";
import { ErrorRequestHandler } from "express";

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  "WALLET_PRIVATE_KEY",
  "RPC_URL",
  "OPENAI_API_KEY",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "EMAIL_FROM",
];

requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    throw new Error(`Environment variable ${envVar} is not defined`);
  }
});

// Configure environment variables with defaults
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY!;
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const PORT = process.env.PORT || 3000;

// Initialize Express app
const app = express();

// Configure middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Initialize services
const solanaAgent = initializeSolanaAgent(PRIVATE_KEY, RPC_URL, OPENAI_KEY);
const invoiceProcessor = new InvoiceProcessor(OPENAI_KEY);
const gmailService = new GmailWatchService();
const transactionService = new TransactionService(solanaAgent, null); // Replace null with your user service

const errorHandler: ErrorRequestHandler = (err, req, res, next): void => {
  console.error("Error:", err);

  if (err instanceof CustomError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({
      error: "File upload error",
      details: err.message,
    });
    return;
  }

  res.status(500).json({
    error: "Internal server error",
    details: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};

// Gmail push notification endpoint
app.post(
  "/webhook/gmail",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { message } = req.body;

      // Extract message ID from the notification
      const messageId = message?.data
        ? Buffer.from(message.data, "base64").toString()
        : null;

      if (!messageId) {
        res.status(400).json({ error: "No message ID provided" });
        return;
      }

      // Process the new email
      const { invoiceText, senderEmail } = await gmailService.processNewEmail(
        messageId
      );

      // Verify sender authorization
      if (!gmailService.verifyEmailAuth(senderEmail)) {
        res.status(401).json({ error: "Unauthorized sender" });
        return;
      }

      // Extract invoice data using LangChain
      const invoice = await invoiceProcessor.extractInvoiceData(invoiceText);

      // Process transaction
      const transaction = await transactionService.createTransaction(invoice);

      // Send confirmation email
      if (senderEmail) {
        await gmailService.sendConfirmationEmail(
          senderEmail,
          transaction.id,
          transaction.status
        );
      }

      // Return status
      res.json({
        message: "Invoice processed successfully",
        transaction,
      });
    } catch (error: any) {
      console.error("Error processing Gmail notification:", error);
      res.status(500).json({
        error: "Failed to process invoice",
        details: error.message,
      });
    }
  }
);

// Legacy email endpoint (keeping for backup/testing)
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
        await gmailService.processInvoiceEmail(req.file.buffer);

      // Verify sender authorization
      if (!gmailService.verifyEmailAuth(senderEmail)) {
        res.status(401).json({ error: "Unauthorized sender" });
        return;
      }

      // Extract invoice data using LangChain
      const invoice = await invoiceProcessor.extractInvoiceData(invoiceText);

      // Process transaction
      const transaction = await transactionService.createTransaction(invoice);

      // Send confirmation email if we have the sender's address
      if (senderEmail) {
        await gmailService.sendConfirmationEmail(
          senderEmail,
          transaction.id,
          transaction.status
        );
      }

      // Return status to client
      res.json({
        message: "Invoice processed successfully",
        transaction,
      });
    } catch (err: any) {
      console.error("Error processing direct email upload:", err);
      res.status(500).json({
        error: "Failed to process invoice",
        details: err.message,
      });
    }
  }
);

// Transaction status endpoint
app.get(
  "/transaction/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const status = await transactionService.getTransactionStatus(
        req.params.id
      );
      if (!status) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }
      res.json(status);
    } catch (err: any) {
      console.error("Error fetching transaction status:", err);
      res.status(500).json({
        error: "Failed to fetch transaction status",
        details: err.message,
      });
    }
  }
);

// Transaction history endpoint
app.get("/transactions", async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    // Get transactions from service
    const transactions = await transactionService.getTransactionHistory(
      limit,
      offset
    );

    res.json(transactions);
  } catch (err: any) {
    console.error("Error fetching transaction history:", err);
    res.status(500).json({
      error: "Failed to fetch transaction history",
      details: err.message,
    });
  }
});

// Health check endpoint
app.get("/health", async (_req: Request, res: Response): Promise<void> => {
  try {
    // Check services health
    const servicesHealth = {
      gmail: await gmailService.checkHealth(),
      solana: await solanaAgent.checkHealth(),
      processor: await invoiceProcessor.checkHealth(),
    };

    const isHealthy = Object.values(servicesHealth).every((status) => status);

    if (!isHealthy) {
      res.status(503).json({
        status: "unhealthy",
        services: servicesHealth,
      });
      return;
    }

    res.json({
      status: "healthy",
      services: servicesHealth,
    });
  } catch (err: any) {
    console.error("Health check failed:", err);
    res.status(503).json({
      status: "unhealthy",
      error: err.message,
    });
  }
});

// Apply error handling middleware
app.use(errorHandler);

// Initialize Gmail watch on startup
gmailService.setupEmailWatch().catch((error) => {
  console.error("Failed to setup Gmail watch:", error);
  // Don't crash the server if Gmail watch setup fails
  // The service can still process direct email uploads
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Implement your error reporting logic here
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Implement your error reporting logic here
});
