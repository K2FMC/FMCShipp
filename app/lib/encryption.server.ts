import CryptoJS from "crypto-js";

const PREFIX = "encrypted:";

export function encrypt(value: string): string {
  const secret = process.env.ENCRYPTION_SECRET!;
  const encrypted = CryptoJS.AES.encrypt(value, secret).toString();
  return `${PREFIX}${btoa(encrypted)}`;
}

export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const secret = process.env.ENCRYPTION_SECRET!;
  const encrypted = atob(value.slice(PREFIX.length));
  const bytes = CryptoJS.AES.decrypt(encrypted, secret);
  return bytes.toString(CryptoJS.enc.Utf8);
}
