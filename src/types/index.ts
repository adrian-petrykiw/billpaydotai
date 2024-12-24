export interface Invoice {
  invoiceNumber: string;
  amount: number;
  currency: string;
  recipient: string;
  dueDate?: string;
  recipientAddress?: string;
}

export interface TransactionStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  invoice: Invoice;
  signature?: string;
  error?: string;
}
