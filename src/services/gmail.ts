import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { ParsedMail, simpleParser } from "mailparser";
import { Buffer } from "buffer";
import { EmailService } from "./email";
import { TransactionStatus } from "../types";

export class GmailWatchService extends EmailService {
  private oauth2Client: OAuth2Client;
  private gmail: ReturnType<typeof google.gmail>;

  constructor() {
    super();
    this.oauth2Client = new OAuth2Client(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );
    this.oauth2Client.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });
    this.gmail = google.gmail({ version: "v1", auth: this.oauth2Client });
  }

  async setupEmailWatch() {
    try {
      await this.gmail.users.watch({
        userId: "me",
        requestBody: {
          labelIds: ["INBOX"],
          topicName: process.env.PUBSUB_TOPIC,
        },
      });
      console.log("Gmail watch setup successfully");
    } catch (error) {
      console.error("Failed to setup Gmail watch:", error);
      throw error;
    }
  }

  async processNewEmail(messageId: string) {
    try {
      const message = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "raw",
      });

      if (!message.data.raw) {
        throw new Error("No raw message data found");
      }

      const emailBuffer = Buffer.from(message.data.raw, "base64");
      return this.processInvoiceEmail(emailBuffer);
    } catch (error) {
      console.error("Failed to process new email:", error);
      throw error;
    }
  }

  async sendConfirmationEmail(
    to: string,
    transactionId: string,
    status: string
  ): Promise<void> {
    try {
      const emailContent = this.createConfirmationEmailContent(
        transactionId,
        status
      );

      const raw = Buffer.from(
        `To: ${to}\r\n` +
          `From: ${process.env.EMAIL_FROM}\r\n` +
          `Subject: Invoice Processing Confirmation\r\n` +
          `Content-Type: text/html; charset=utf-8\r\n\r\n` +
          emailContent
      ).toString("base64url");

      await this.gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
    } catch (error) {
      console.error("Failed to send confirmation email:", error);
      throw error;
    }
  }

  private createConfirmationEmailContent(
    transactionId: string,
    status: string
  ): string {
    return `
      <html>
        <body>
          <h2>Invoice Processing Confirmation</h2>
          <p>Your invoice has been received and processed.</p>
          <p>Transaction ID: ${transactionId}</p>
          <p>Status: ${status}</p>
          <p>You will receive another notification once the payment is completed.</p>
        </body>
      </html>
    `;
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.gmail.users.getProfile({ userId: "me" });
      return true;
    } catch (error) {
      console.error("Gmail health check failed:", error);
      return false;
    }
  }
}
