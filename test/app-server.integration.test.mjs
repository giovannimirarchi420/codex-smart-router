import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { loadCodexCatalog } from "../src/catalog.mjs";
import { startProxy } from "../src/proxy.mjs";

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForResponse(socket, id, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for App Server response ${id}`));
    }, timeoutMs);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString("utf8"));
      if (message.id !== id) return;
      cleanup();
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
    };
    socket.on("message", onMessage);
  });
}

test("proxies a real Codex App Server handshake and ephemeral thread", async () => {
  const catalog = loadCodexCatalog();
  const proxy = await startProxy({ catalog, audit: false });
  const socket = new WebSocket(proxy.url, {
    headers: { authorization: `Bearer ${proxy.authToken}` },
  });

  try {
    await waitForOpen(socket);
    socket.send(JSON.stringify({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "codex_smart_router_test", title: "Codex Smart Router Test", version: "0.1.0" },
      },
    }));
    const initialized = await waitForResponse(socket, 1);
    assert.equal(typeof initialized.userAgent, "string");

    socket.send(JSON.stringify({ method: "initialized", params: {} }));
    socket.send(JSON.stringify({
      method: "thread/start",
      id: 2,
      params: {
        cwd: "/tmp",
        ephemeral: true,
        sandbox: "read-only",
      },
    }));
    const started = await waitForResponse(socket, 2);
    assert.match(started.thread.id, /\S+/);
    assert.equal(started.thread.ephemeral, true);
  } finally {
    await new Promise((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });
    await proxy.close();
  }
});
