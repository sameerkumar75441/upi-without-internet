import crypto from "node:crypto";

const RSA_BYTES = 256;
const IV_BYTES = 12;
let keyPair;

export function initialiseKeys() {
  keyPair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
export function publicKeyBase64() {
  return Buffer.from(keyPair.publicKey).toString("base64");
}
export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
export function encrypt(instruction) {
  const aesKey = crypto.randomBytes(32),
    iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(instruction), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const wrapped = crypto.publicEncrypt(
    {
      key: keyPair.publicKey,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    aesKey,
  );
  return Buffer.concat([wrapped, iv, encrypted]).toString("base64");
}
export function decrypt(ciphertext) {
  const data = Buffer.from(ciphertext, "base64");
  if (data.length <= RSA_BYTES + IV_BYTES + 16)
    throw new Error("ciphertext_too_short");
  const aesKey = crypto.privateDecrypt(
    {
      key: keyPair.privateKey,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    data.subarray(0, RSA_BYTES),
  );
  const iv = data.subarray(RSA_BYTES, RSA_BYTES + IV_BYTES),
    encryptedAndTag = data.subarray(RSA_BYTES + IV_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(encryptedAndTag.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(encryptedAndTag.subarray(0, -16)),
      decipher.final(),
    ]).toString("utf8"),
  );
}
