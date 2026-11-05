import nodemailer from 'nodemailer';
import { config } from './config';

export function mailer() {
  const c = config();
  return nodemailer.createTransport({
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    host: c.SMTP_HOST,
    port: c.SMTP_PORT,
    secure: c.SMTP_PORT === 465,
    ...(c.SMTP_USER ? { auth: { user: c.SMTP_USER, pass: c.SMTP_PASSWORD } } : {}),
  });
}
