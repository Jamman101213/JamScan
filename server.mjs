import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production" || process.argv.includes("--production");
const sessionTtlMs = 10 * 60 * 1000;
const activeSessionTtlMs = 60 * 60 * 1000;
const sessions = new Map();
const sockets = new Set();
let vite = null;

if (!isProduction) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "mpa",
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/runtime") {
    sendJson(response, {
      publicOrigin: process.env.PUBLIC_ORIGIN || "",
      suggestedOrigins: getSuggestedOrigins(request),
      iceServers: getIceServers(),
      sessionTtlMs,
    });
    return;
  }

  if (vite) {
    vite.middlewares(request, response, () => sendNotFound(response));
    return;
  }
  serveStatic(url.pathname, response);
});

server.on("upgrade", (request, socket) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/signal") {
    socket.destroy();
    return;
  }
  const key = request.headers["sec-websocket-key"];
  const version = request.headers["sec-websocket-version"];
  if (typeof key !== "string" || version !== "13") {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n"));
  const client = createWebSocketConnection(socket);
  sockets.add(client);
});

function createWebSocketConnection(socket) {
  const client = {
    socket,
    buffer: Buffer.alloc(0),
    fragments: [],
    fragmentOpcode: 0,
    isAlive: true,
    sessionId: null,
    role: null,
    send(message) {
      if (!socket.destroyed && socket.writable) writeFrame(socket, Buffer.from(JSON.stringify(message)), 0x1);
    },
    close() {
      if (!socket.destroyed) writeFrame(socket, Buffer.alloc(0), 0x8);
      socket.end();
    },
  };

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    try {
      processFrames(client);
    } catch {
      client.close();
    }
  });
  socket.on("close", () => {
    sockets.delete(client);
    removeSocket(client);
  });
  socket.on("error", () => socket.destroy());
  return client;
}

function processFrames(client) {
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const final = Boolean(first & 0x80);
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let offset = 2;

    if (!masked) throw new Error("Client frames must be masked.");
    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const bigLength = client.buffer.readBigUInt64BE(2);
      if (bigLength > 256n * 1024n) throw new Error("Frame too large.");
      length = Number(bigLength);
      offset = 10;
    }
    if (length > 256 * 1024) throw new Error("Frame too large.");
    if (client.buffer.length < offset + 4 + length) return;

    const mask = client.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
    client.buffer = client.buffer.subarray(offset + length);
    for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];

    if (opcode === 0x8) {
      client.close();
      return;
    }
    if (opcode === 0x9) {
      writeFrame(client.socket, payload, 0xA);
      continue;
    }
    if (opcode === 0xA) {
      client.isAlive = true;
      continue;
    }
    if (opcode === 0x1 || opcode === 0x2) {
      client.fragmentOpcode = opcode;
      client.fragments = [payload];
    } else if (opcode === 0x0 && client.fragmentOpcode) {
      client.fragments.push(payload);
    } else {
      continue;
    }

    if (final) {
      const fullPayload = Buffer.concat(client.fragments);
      const messageOpcode = client.fragmentOpcode;
      client.fragments = [];
      client.fragmentOpcode = 0;
      if (messageOpcode === 0x1) handleTextMessage(client, fullPayload.toString("utf8"));
    }
  }
}

function writeFrame(socket, payload, opcode) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function handleTextMessage(client, text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    client.send({ type: "error", code: "BAD_JSON", message: "Invalid signaling message." });
    return;
  }
  handleMessage(client, message);
}

function handleMessage(client, message) {
  if (message.type === "create") {
    const key = cleanToken(message.key, 128);
    if (!key) return client.send({ type: "error", code: "BAD_KEY", message: "Pairing key is invalid." });
    removeSocket(client);
    const id = uniqueSessionId();
    const session = {
      id,
      keyHash: hashKey(key),
      sender: client,
      receiver: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + sessionTtlMs,
    };
    sessions.set(id, session);
    client.sessionId = id;
    client.role = "sender";
    client.send({ type: "created", session: id, expiresAt: session.expiresAt });
    return;
  }

  if (message.type === "join") {
    const id = cleanToken(message.session, 32).toUpperCase();
    const key = cleanToken(message.key, 128);
    const session = sessions.get(id);
    if (!session || session.expiresAt < Date.now()) {
      return client.send({ type: "error", code: "SESSION_NOT_FOUND", message: "This pairing session expired or does not exist." });
    }
    if (!key || !safeEqual(session.keyHash, hashKey(key))) {
      return client.send({ type: "error", code: "PAIRING_DENIED", message: "The pairing secret is incorrect." });
    }
    if (session.receiver && !session.receiver.socket.destroyed) {
      return client.send({ type: "error", code: "SESSION_FULL", message: "Another receiver already joined this session." });
    }
    session.receiver = client;
    session.expiresAt = Date.now() + activeSessionTtlMs;
    client.sessionId = id;
    client.role = "receiver";
    client.send({ type: "joined", session: id });
    session.sender?.send({ type: "peer-ready" });
    return;
  }

  if (message.type === "signal") {
    const session = sessions.get(client.sessionId);
    if (!session) return;
    session.expiresAt = Date.now() + activeSessionTtlMs;
    const target = client.role === "sender" ? session.receiver : session.sender;
    target?.send({ type: "signal", data: message.data });
    return;
  }

  if (message.type === "leave") removeSocket(client);
}

function removeSocket(client) {
  const id = client.sessionId;
  if (!id) return;
  const session = sessions.get(id);
  if (!session) return;
  if (session.sender === client) {
    session.receiver?.send({ type: "peer-left" });
    sessions.delete(id);
  } else if (session.receiver === client) {
    session.receiver = null;
    session.sender?.send({ type: "peer-left" });
  }
  client.sessionId = null;
  client.role = null;
}

function uniqueSessionId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  do {
    let value = "";
    const bytes = crypto.randomBytes(8);
    for (let index = 0; index < 8; index++) value += alphabet[bytes[index] % alphabet.length];
    if (!sessions.has(value)) return value;
  } while (true);
}

function cleanToken(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength && /^[A-Za-z0-9_-]+$/.test(value) ? value : "";
}

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest();
}

function safeEqual(left, right) {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getIceServers() {
  const iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(",").map((value) => value.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return iceServers;
}

function getSuggestedOrigins(request) {
  const results = new Set();
  const forwardedProto = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim();
  const protocol = forwardedProto || "http";
  const host = request.headers.host;
  if (host) results.add(`${protocol}://${host}`);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) results.add(`http://${address.address}:${port}`);
    }
  }
  return [...results];
}

function sendJson(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function serveStatic(pathname, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendNotFound(response);
    return;
  }
  const relative = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const root = path.join(__dirname, "dist");
  const filePath = path.resolve(root, `.${relative}`);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    sendNotFound(response);
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      sendNotFound(response);
      return;
    }
    response.writeHead(200, { "Content-Type": mimeType(filePath), "Content-Length": stat.size });
    fs.createReadStream(filePath).pipe(response);
  });
}

function mimeType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".wasm": "application/wasm",
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) {
      session.sender?.send({ type: "expired" });
      session.receiver?.send({ type: "expired" });
      sessions.delete(id);
    }
  }
  for (const client of sockets) {
    if (!client.isAlive) {
      client.socket.destroy();
      continue;
    }
    client.isAlive = false;
    writeFrame(client.socket, Buffer.alloc(0), 0x9);
  }
}, 30_000).unref();

server.listen(port, "0.0.0.0", () => {
  console.log(`JamScan running at http://localhost:${port}`);
});
