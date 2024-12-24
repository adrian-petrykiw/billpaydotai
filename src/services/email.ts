// src/services/email.ts
import { ParsedMail, simpleParser, Attachment } from "mailparser";
import { Buffer } from "buffer";
import pdfParse from "pdf-parse";

// Define our simplified attachment type
interface SimplifiedAttachment {
  filename: string;
  content: Buffer;
}

export class EmailService {
  constructor() {}

  private isValidAttachment(
    attachment: Attachment
  ): attachment is Attachment & { filename: string } {
    return typeof attachment.filename === "string";
  }

  private simplifyAttachment(
    attachment: Attachment & { filename: string }
  ): SimplifiedAttachment {
    return {
      filename: attachment.filename,
      content: attachment.content,
    };
  }

  async parseEmail(rawEmail: Buffer): Promise<{
    attachments: SimplifiedAttachment[];
    text: string;
    from?: string;
  }> {
    try {
      // Parse the raw email
      const parsed: ParsedMail = await simpleParser(rawEmail);

      // Extract and process attachments
      const validAttachments = parsed.attachments.filter(
        this.isValidAttachment
      );
      const processedAttachments = validAttachments.map(
        this.simplifyAttachment
      );

      return {
        attachments: processedAttachments,
        text: parsed.text || "",
        from: parsed.from?.text,
      };
    } catch (error: any) {
      throw new Error(`Failed to parse email: ${error.message}`);
    }
  }

  async extractPDFText(pdfBuffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(pdfBuffer);
      return data.text;
    } catch (error: any) {
      throw new Error(`Failed to parse PDF: ${error.message}`);
    }
  }

  async processInvoiceEmail(emailData: Buffer): Promise<{
    invoiceText: string;
    senderEmail?: string;
  }> {
    // Parse the email
    const parsedEmail = await this.parseEmail(emailData);

    // Look for PDF attachments
    const pdfAttachment = parsedEmail.attachments.find((att) =>
      att.filename.toLowerCase().endsWith(".pdf")
    );

    if (!pdfAttachment) {
      throw new Error("No PDF invoice found in email");
    }

    // Extract text from PDF
    const invoiceText = await this.extractPDFText(pdfAttachment.content);

    return {
      invoiceText,
      senderEmail: parsedEmail.from,
    };
  }

  verifyEmailAuth(senderEmail?: string): boolean {
    return !!senderEmail;
  }
}
