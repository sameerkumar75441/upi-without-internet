import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
    vpa: { type: String, required: true, unique: true },
    holderName: { type: String, required: true },
    balance: { type: Number, required: true, min: 0 },
    pinHash: { type: String, required: true, select: false },
  },
  { versionKey: "version" },
);

const transactionSchema = new mongoose.Schema(
  {
    packetHash: { type: String, required: true, unique: true, index: true },
    senderVpa: { type: String, required: true },
    receiverVpa: { type: String, required: true },
    amount: { type: Number, required: true },
    signedAt: { type: Date, required: true },
    settledAt: { type: Date, required: true },
    bridgeNodeId: { type: String, required: true },
    hopCount: { type: Number, required: true },
    status: { type: String, enum: ["SETTLED", "REJECTED"], required: true },
  },
  { versionKey: false },
);

// A TTL-backed claim is made before decrypting. It is MongoDB's durable equivalent
// of ConcurrentHashMap.putIfAbsent / Redis SET NX in the Java version.
const claimSchema = new mongoose.Schema(
  {
    packetHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { versionKey: false },
);

export const Account = mongoose.model("Account", accountSchema);
export const Transaction = mongoose.model("Transaction", transactionSchema);
export const PacketClaim = mongoose.model("PacketClaim", claimSchema);
