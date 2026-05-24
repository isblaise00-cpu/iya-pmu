import { logger } from '../lib/logger';
import axios from 'axios';

export interface SmsMessage {
  to: string;
  message: string;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SmsAdapter {
  send(msg: SmsMessage): Promise<SmsResult>;
  sendBulk(messages: SmsMessage[]): Promise<SmsResult[]>;
}

class MockSmsAdapter implements SmsAdapter {
  async send(msg: SmsMessage): Promise<SmsResult> {
    logger.info(`[SMS MOCK] To: ${msg.to} | Message: ${msg.message}`);
    return { success: true, messageId: `mock_${Date.now()}` };
  }

  async sendBulk(messages: SmsMessage[]): Promise<SmsResult[]> {
    return Promise.all(messages.map((m) => this.send(m)));
  }
}

class OrangeSmsAdapter implements SmsAdapter {
  private apiKey = process.env.SMS_API_KEY!;
  private sender = process.env.SMS_SENDER || 'PMU-PRONO';

  async send(msg: SmsMessage): Promise<SmsResult> {
    try {
      const res = await axios.post(
        'https://api.orange.com/smsmessaging/v1/outbound/tel:${this.sender}/requests',
        {
          outboundSMSMessageRequest: {
            address: `tel:${msg.to}`,
            senderAddress: `tel:${this.sender}`,
            outboundSMSTextMessage: { message: msg.message },
          },
        },
        { headers: { Authorization: `Bearer ${this.apiKey}` } }
      );
      return { success: true, messageId: res.data?.resourceReference?.resourceURL };
    } catch (err: any) {
      logger.error('Orange SMS error:', err.message);
      return { success: false, error: err.message };
    }
  }

  async sendBulk(messages: SmsMessage[]): Promise<SmsResult[]> {
    return Promise.all(messages.map((m) => this.send(m)));
  }
}

class TwilioSmsAdapter implements SmsAdapter {
  private accountSid = process.env.SMS_TWILIO_ACCOUNT_SID!;
  private authToken = process.env.SMS_API_KEY!;
  private from = process.env.SMS_SENDER!;

  async send(msg: SmsMessage): Promise<SmsResult> {
    try {
      const res = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        new URLSearchParams({ To: msg.to, From: this.from, Body: msg.message }),
        { auth: { username: this.accountSid, password: this.authToken } }
      );
      return { success: true, messageId: res.data.sid };
    } catch (err: any) {
      logger.error('Twilio SMS error:', err.message);
      return { success: false, error: err.message };
    }
  }

  async sendBulk(messages: SmsMessage[]): Promise<SmsResult[]> {
    return Promise.all(messages.map((m) => this.send(m)));
  }
}

function createSmsAdapter(): SmsAdapter {
  const provider = process.env.SMS_PROVIDER || 'mock';
  switch (provider) {
    case 'orange': return new OrangeSmsAdapter();
    case 'twilio': return new TwilioSmsAdapter();
    default: return new MockSmsAdapter();
  }
}

export const smsAdapter = createSmsAdapter();
