import test from "node:test";
import assert from "node:assert/strict";
import { initialiseKeys, encrypt, decrypt } from "../src/crypto.js";

test("hybrid encryption round-trips an offline payment instruction", () => {
  initialiseKeys();
  const original = {
    senderVpa: "alice@demo",
    receiverVpa: "bob@demo",
    amount: 500,
    nonce: "unique",
    signedAt: Date.now(),
  };
  assert.deepEqual(decrypt(encrypt(original)), original);
});

test("tampered ciphertext is rejected by AES-GCM authentication", () => {
  initialiseKeys();
  const bytes = Buffer.from(encrypt({ senderVpa: "alice@demo" }), "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decrypt(bytes.toString("base64")));
});
