import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import http from "node:http";
import { Server } from "socket.io";
import { Account, Transaction, PacketClaim } from "./models.js";
import {
  initialiseKeys,
  publicKeyBase64,
  sha256,
  encrypt,
  decrypt,
} from "./crypto.js";
import {
  createPacket,
  inject,
  state,
  gossipOnce,
  bridgeUploads,
  resetMesh,
} from "./mesh.js";

const app = express(),
  port = Number(process.env.PORT || 8080),
  maxAge = Number(process.env.PACKET_MAX_AGE_SECONDS || 86400),
  claimTtl = Number(process.env.IDEMPOTENCY_TTL_SECONDS || 86400);
const allowedOrigins = (
  process.env.CORS_ORIGIN || "http://127.0.0.1:5173,http://localhost:5173"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "X-Bridge-Node-Id", "X-Hop-Count"],
};
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: corsOptions });
app.disable("x-powered-by");
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: "100kb" }));
initialiseKeys();
const publish = (type, payload = {}) =>
  io.emit("mesh:update", { type, occurredAt: Date.now(), ...payload });

const demoAccounts = [
  { vpa: "alice@demo", holderName: "Alice", balance: 5000 },
  { vpa: "bob@demo", holderName: "Bob", balance: 1000 },
  { vpa: "carol@demo", holderName: "Carol", balance: 2500 },
  { vpa: "dave@demo", holderName: "Dave", balance: 500 },
];
async function seed() {
  if (await Account.countDocuments()) return;
  await Account.insertMany(
    demoAccounts.map((account) => ({ ...account, pinHash: sha256("1234") })),
  );
}
async function ingest(packet, bridgeNodeId, hopCount) {
  const packetHash = sha256(packet.ciphertext || "");
  try {
    await PacketClaim.create({
      packetHash,
      expiresAt: new Date(Date.now() + claimTtl * 1000),
    });
  } catch (e) {
    if (e.code === 11000)
      return {
        outcome: "DUPLICATE_DROPPED",
        packetHash,
        reason: null,
        transactionId: null,
      };
    return {
      outcome: "INVALID",
      packetHash: "?",
      reason: `internal_error: ${e.message}`,
      transactionId: null,
    };
  }
  let instruction;
  try {
    instruction = decrypt(packet.ciphertext);
  } catch {
    return {
      outcome: "INVALID",
      packetHash,
      reason: "decryption_failed",
      transactionId: null,
    };
  }
  const age = (Date.now() - instruction.signedAt) / 1000;
  if (age > maxAge)
    return {
      outcome: "INVALID",
      packetHash,
      reason: "stale_packet",
      transactionId: null,
    };
  if (age < -300)
    return {
      outcome: "INVALID",
      packetHash,
      reason: "future_dated",
      transactionId: null,
    };
  const session = await mongoose.startSession();
  try {
    let transaction;
    await session.withTransaction(async () => {
      // Keep the Java service's error distinction: an unknown VPA is invalid,
      // while a known account with too little balance gets a rejected ledger row.
      const knownSender = await Account.findOne({ vpa: instruction.senderVpa })
        .select("+pinHash")
        .session(session);
      if (!knownSender)
        throw new Error(`Unknown sender VPA: ${instruction.senderVpa}`);
      if (knownSender.pinHash !== instruction.pinHash)
        throw new Error("invalid_pin");
      const sender = await Account.findOneAndUpdate(
        { vpa: instruction.senderVpa, balance: { $gte: instruction.amount } },
        { $inc: { balance: -instruction.amount } },
        { new: true, session },
      );
      const receiver = await Account.findOne({
        vpa: instruction.receiverVpa,
      }).session(session);
      if (!receiver)
        throw new Error(`Unknown receiver VPA: ${instruction.receiverVpa}`);
      const common = {
        packetHash,
        senderVpa: instruction.senderVpa,
        receiverVpa: instruction.receiverVpa,
        amount: instruction.amount,
        signedAt: new Date(instruction.signedAt),
        settledAt: new Date(),
        bridgeNodeId,
        hopCount,
      };
      if (!sender) {
        transaction = (
          await Transaction.create([{ ...common, status: "REJECTED" }], {
            session,
          })
        )[0];
        return;
      }
      await Account.updateOne(
        { _id: receiver._id },
        { $inc: { balance: instruction.amount } },
        { session },
      );
      transaction = (
        await Transaction.create([{ ...common, status: "SETTLED" }], {
          session,
        })
      )[0];
    });
    return {
      outcome: transaction.status === "SETTLED" ? "SETTLED" : "REJECTED",
      packetHash,
      reason: null,
      transactionId: transaction._id.toString(),
    };
  } catch (e) {
    return {
      outcome: "INVALID",
      packetHash,
      reason: `internal_error: ${e.message}`,
      transactionId: null,
    };
  } finally {
    await session.endSession();
  }
}
app.get("/api/server-key", (_, res) =>
  res.json({
    publicKey: publicKeyBase64(),
    algorithm: "RSA-2048 / OAEP-SHA256",
    hybridScheme: "RSA-OAEP encrypts an AES-256-GCM session key",
  }),
);
app.get("/health", (_, res) =>
  res.status(200).json({
    status: "ok",
    service: "upi-offline-mesh-api",
    timestamp: new Date().toISOString(),
  }),
);
app.get("/api/accounts", async (_, res) =>
  res.json(await Account.find().sort({ vpa: 1 }).lean()),
);
app.get("/api/transactions", async (_, res) =>
  res.json(await Transaction.find().sort({ _id: -1 }).limit(20).lean()),
);
app.get("/api/mesh/state", async (_, res) =>
  res.json(state(await PacketClaim.countDocuments())),
);
app.post("/api/demo/send", (req, res) => {
  try {
    const {
      senderVpa,
      receiverVpa,
      amount,
      pin,
      ttl = 5,
      startDevice = "phone-alice",
    } = req.body;
    if (!senderVpa || !receiverVpa || !Number(amount) || !pin)
      return res.status(400).json({
        error: "senderVpa, receiverVpa, positive amount and pin are required",
      });
    const packet = createPacket(
      senderVpa,
      receiverVpa,
      amount,
      pin,
      ttl,
      encrypt,
    );
    inject(startDevice, packet);
    const result = {
      packetId: packet.packetId,
      ciphertextPreview: `${packet.ciphertext.slice(0, 64)}...`,
      ttl: packet.ttl,
      injectedAt: startDevice,
    };
    publish("packet_injected", result);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/mesh/gossip", (_, res) => {
  const result = gossipOnce();
  publish("gossip_completed", result);
  res.json(result);
});
app.post("/api/mesh/flush", async (_, res) => {
  const uploads = bridgeUploads();
  const results = await Promise.all(
    uploads.map(({ packet, bridgeNodeId }) =>
      ingest(packet, bridgeNodeId, 5 - packet.ttl).then((r) => ({
        bridgeNode: bridgeNodeId,
        packetId: packet.packetId.slice(0, 8),
        ...r,
      })),
    ),
  );
  const result = { uploadsAttempted: uploads.length, results };
  publish("bridge_processed", result);
  res.json(result);
});
app.post("/api/mesh/reset", async (_, res) => {
  resetMesh();
  await PacketClaim.deleteMany({});
  publish("mesh_reset");
  res.json({ status: "mesh and idempotency cache cleared" });
});
app.post("/api/demo/reset-all", async (_, res) => {
  resetMesh();
  await PacketClaim.deleteMany({});
  await Transaction.deleteMany({});
  await Account.deleteMany({});
  await Account.insertMany(
    demoAccounts.map((account) => ({ ...account, pinHash: sha256("1234") })),
  );
  publish("demo_reset");
  res.json({
    status: "demo balances, ledger, mesh and packet claims reset",
    pinHint: "All demo accounts use PIN 1234",
  });
});
app.post("/api/bridge/ingest", async (req, res) =>
  res.json(
    await ingest(
      req.body,
      req.get("X-Bridge-Node-Id") || "unknown",
      Number(req.get("X-Hop-Count") || 0),
    ),
  ),
);
mongoose
  .connect(
    process.env.MONGODB_URI ||
      "mongodb://localhost:27017/upi_mesh?replicaSet=rs0",
  )
  .then(async () => {
    await seed();
    httpServer.listen(port, () =>
      console.log(`UPI Mesh API listening on http://localhost:${port}`),
    );
  })
  .catch((e) => {
    console.error("MongoDB connection failed:", e.message);
    process.exit(1);
  });
function shutdown(signal) {
  console.log(`${signal} received, closing services`);
  httpServer.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
