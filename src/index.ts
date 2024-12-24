// src/index.ts
import express from "express";
import multer from "multer";
import { initializeSolanaAgent } from "./config/solana";
import { InvoiceProcessor } from "./services/invoice";
import { InvoiceProcessingChain } from "./chains/invoiceProcessing";

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
const processingChain = new InvoiceProcessingChain(
  solanaAgent,
  invoiceProcessor
);

// Email endpoint to handle invoice processing
app.post("/email", upload.single("invoice"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No invoice file provided" });
    }

    // Convert PDF buffer to text (we'll implement this properly next)
    const pdfText = req.file.buffer.toString();

    // Process the invoice
    const status = await processingChain.processInvoice(pdfText);

    res.json({
      message: "Invoice received and processing started",
      status,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to process invoice",
      details: error.message,
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
