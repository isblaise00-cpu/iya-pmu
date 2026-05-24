function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  IS_PROD: process.env.NODE_ENV === 'production',
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  AI_ENGINE_URL: process.env.AI_ENGINE_URL ?? 'http://localhost:8000',
  SMS_PROVIDER: process.env.SMS_PROVIDER ?? 'mock',
  SMS_API_KEY: process.env.SMS_API_KEY ?? '',
  SMS_SENDER: process.env.SMS_SENDER ?? 'PMU-PRONO',
  SMS_TWILIO_ACCOUNT_SID: process.env.SMS_TWILIO_ACCOUNT_SID ?? '',
};
