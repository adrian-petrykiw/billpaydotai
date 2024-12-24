import { Invoice } from "../types";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import {
  MessageContentText,
  MessageContent,
  MessageContentComplex,
} from "@langchain/core/messages";

export class InvoiceProcessor {
  private model: ChatOpenAI;

  constructor(openAiKey: string) {
    this.model = new ChatOpenAI({
      openAIApiKey: openAiKey,
      modelName: "gpt-4-turbo-preview",
      temperature: 0,
    });
  }

  private isMessageContentText(
    content: MessageContentComplex
  ): content is MessageContentText {
    return content.type === "text";
  }

  private extractText(content: MessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (this.isMessageContentText(item)) {
            return item.text;
          }
          return "";
        })
        .join("");
    }
    return "";
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

    const response = (await this.model.invoke([
      systemPrompt,
      userPrompt,
    ])) as AIMessage;
    const contentStr = this.extractText(response.content);

    if (!contentStr) {
      throw new Error("Failed to extract text content from model response");
    }

    return JSON.parse(contentStr) as Invoice;
  }

  async validateInvoice(invoice: Invoice): Promise<boolean> {
    // Add validation logic here
    return true;
  }

  async checkHealth(): Promise<boolean> {
    try {
      // Test the OpenAI connection
      const testMessage = await this.model.invoke([
        { content: "test", role: "user" },
      ]);
      return !!testMessage;
    } catch (error) {
      console.error("Invoice processor health check failed:", error);
      return false;
    }
  }
}
