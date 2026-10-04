import { logger } from '../lib/logger';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const smpp = require('smpp');

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

class SmppSmsAdapter implements SmsAdapter {
  private host     = process.env.SMPP_HOST!;
  private port     = Number(process.env.SMPP_PORT || 5019);
  private systemId = process.env.SMPP_LOGIN!;
  private password = process.env.SMPP_PASSWORD!;
  private sender   = process.env.SMS_SENDER || 'IYA';
  private session: any = null;

  private connect(): Promise<any> {
    return new Promise((resolve, reject) => {
      const session = smpp.connect({
        host: this.host,
        port: this.port,
        auto_enquire_link_period: 30000,
      });

      session.bind_transceiver({
        system_id:         this.systemId,
        password:          this.password,
        interface_version: 0x34,
      }, (pdu: any) => {
        if (pdu.command_status === 0) {
          logger.info('[SMPP] Connexion et authentification réussies.');
          resolve(session);
        } else {
          reject(new Error(`SMPP bind échoué — status: ${pdu.command_status}`));
        }
      });

      session.on('error', (err: Error) => {
        this.session = null;
        logger.error('[SMPP] Erreur de session:', err.message);
        reject(err);
      });

      session.on('close', () => {
        this.session = null;
        logger.warn('[SMPP] Session fermée.');
      });
    });
  }

  private async getSession(): Promise<any> {
    if (this.session && !this.session.socket.destroyed) return this.session;
    this.session = await this.connect();
    return this.session;
  }

  async send(msg: SmsMessage): Promise<SmsResult> {
    try {
      const session = await this.getSession();
      return new Promise((resolve) => {
        // ╔══════════════════════════════════════════════════════════════════╗
        // ║  CONFIGURATION SMPP VALIDÉE — NE PAS MODIFIER                  ║
        // ║  Opérateur : ONatel Burkina Faso                                ║
        // ║  Testée et confirmée fonctionnelle le 04/10/2026               ║
        // ║                                                                  ║
        // ║  • source_addr_ton=5 : expéditeur alphanumérique (SMS_SENDER)  ║
        // ║  • source_addr_npi=0 : requis par ONatel avec TON=5            ║
        // ║  • dest_addr_ton=1  : numérotation internationale              ║
        // ║  • dest_addr_npi=1  : plan ISDN/E.164                         ║
        // ║  • destAddr sans "+" : SMPP n'accepte pas le signe +           ║
        // ║  • data_coding=0    : GSM7 (ASCII), =8 : UCS2 (accents/emoji) ║
        // ║  • registered_delivery=1 : accusé de réception activé          ║
        // ╚══════════════════════════════════════════════════════════════════╝
        const needsUcs2 = /[^\x00-\x7F]/.test(msg.message);
        const destAddr  = msg.to.replace(/^\+/, ''); // ex: +22671439050 → 22671439050
        session.submit_sm({
          source_addr:         this.sender,
          source_addr_ton:     5,
          source_addr_npi:     0,
          destination_addr:    destAddr,
          dest_addr_ton:       1,
          dest_addr_npi:       1,
          short_message:       msg.message,
          data_coding:         needsUcs2 ? 8 : 0,
          registered_delivery: 1,
        }, (pdu: any) => {
          if (pdu.command_status === 0) {
            logger.info(`[SMPP] SMS envoyé à ${msg.to} — id: ${pdu.message_id}`);
            resolve({ success: true, messageId: String(pdu.message_id) });
          } else {
            logger.error(`[SMPP] Échec envoi à ${msg.to} — status: ${pdu.command_status}`);
            resolve({ success: false, error: `SMPP status: ${pdu.command_status}` });
          }
        });
      });
    } catch (err: any) {
      logger.error('[SMPP] Erreur:', err.message);
      return { success: false, error: err.message };
    }
  }

  async sendBulk(messages: SmsMessage[]): Promise<SmsResult[]> {
    // Envoi séquentiel pour ne pas surcharger la session SMPP
    const results: SmsResult[] = [];
    for (const m of messages) {
      results.push(await this.send(m));
    }
    return results;
  }
}

function createSmsAdapter(): SmsAdapter {
  const provider = process.env.SMS_PROVIDER || 'mock';
  switch (provider) {
    case 'orange': return new OrangeSmsAdapter();
    case 'twilio': return new TwilioSmsAdapter();
    case 'smpp':   return new SmppSmsAdapter();
    default:       return new MockSmsAdapter();
  }
}

export const smsAdapter = createSmsAdapter();
