// src/types/index.ts

import { Invoice } from "../types";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { HumanMessage, SystemMessage } from "langchain/schema";

export class InvoiceProcessor {
  private model: ChatOpenAI;

  constructor(openAiKey: string) {
    this.model = new ChatOpenAI({
      openAIApiKey: openAiKey,
      modelName: "gpt-4-turbo-preview",
      temperature: 0,
    });
  }

  async extractInvoiceData(pdfText: string): Promise<Invoice> {
    const systemPrompt = new SystemMessage({
      content: `You are an expert invoice parser. Extract the following information from the invoice:
        - Invoice number
        - Total amount
        - Currency
        - Recipient name/company
        - Due date (if available)
        - Recipient payment address (if available)
        
        Return the data in a strict JSON format matching the Invoice interface.`,
    });

    const userPrompt = new HumanMessage({
      content: pdfText,
    });

    const response = await this.model.invoke([systemPrompt, userPrompt]);
    return JSON.parse(response.content) as Invoice;
  }

  async validateInvoice(invoice: Invoice): Promise<boolean> {
    // Add validation logic here
    return true;
  }
}
