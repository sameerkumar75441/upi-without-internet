import crypto from "node:crypto";
const devices = new Map();
export function resetMesh() {
  devices.clear();
  [
    "phone-alice",
    "phone-stranger1",
    "phone-stranger2",
    "phone-stranger3",
  ].forEach((id) =>
    devices.set(id, { deviceId: id, hasInternet: false, packets: new Map() }),
  );
  devices.set("phone-bridge", {
    deviceId: "phone-bridge",
    hasInternet: true,
    packets: new Map(),
  });
}
resetMesh();
export function createPacket(
  senderVpa,
  receiverVpa,
  amount,
  pin,
  ttl,
  encrypt,
) {
  const instruction = {
    senderVpa,
    receiverVpa,
    amount: Number(amount),
    pinHash: crypto.createHash("sha256").update(String(pin)).digest("hex"),
    nonce: crypto.randomUUID(),
    signedAt: Date.now(),
  };
  return {
    packetId: crypto.randomUUID(),
    ttl,
    createdAt: Date.now(),
    ciphertext: encrypt(instruction),
  };
}
export function inject(deviceId, packet) {
  const d = devices.get(deviceId);
  if (!d) throw new Error(`Unknown device: ${deviceId}`);
  d.packets.set(packet.packetId, packet);
}
export function state(cacheSize) {
  return {
    devices: [...devices.values()].map((d) => ({
      deviceId: d.deviceId,
      hasInternet: d.hasInternet,
      packetCount: d.packets.size,
      packetIds: [...d.packets.keys()].map((id) => id.slice(0, 8)),
    })),
    idempotencyCacheSize: cacheSize,
  };
}
export function gossipOnce() {
  const snapshot = [...devices.values()].map((d) => [
    d,
    [...d.packets.values()],
  ]);
  let transfers = 0;
  for (const [src, packets] of snapshot)
    for (const packet of packets)
      if (packet.ttl > 0)
        for (const dst of devices.values())
          if (dst !== src && !dst.packets.has(packet.packetId)) {
            dst.packets.set(packet.packetId, {
              ...packet,
              ttl: packet.ttl - 1,
            });
            transfers++;
          }
  return {
    transfers,
    deviceCounts: Object.fromEntries(
      [...devices.values()].map((d) => [d.deviceId, d.packets.size]),
    ),
  };
}
export function bridgeUploads() {
  return [...devices.values()]
    .filter((d) => d.hasInternet)
    .flatMap((d) =>
      [...d.packets.values()].map((packet) => ({
        bridgeNodeId: d.deviceId,
        packet,
      })),
    );
}
