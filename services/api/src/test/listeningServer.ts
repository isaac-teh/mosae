import type { Application } from "express";
import type { Server } from "node:http";
import { afterEach } from "vitest";

// Supertest connects to 127.0.0.1, but starts an Express app on an unspecified
// interface and closes it after each request. Under parallel tests that can
// connect to another local service on the selected port. Keep a test server
// bound to the same interface until the test ends.
const servers = new Map<Application, Server>();

export async function listeningServer(app: Application): Promise<Server> {
  let server = servers.get(app);
  if (!server) {
    server = app.listen(0, "127.0.0.1");
    servers.set(app, server);
  }
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        server!.off("listening", onListening);
        server!.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        server!.off("listening", onListening);
        reject(error);
      };
      server!.once("listening", onListening);
      server!.once("error", onError);
      if (server!.listening) onListening();
    });
  }
  return server;
}

afterEach(async () => {
  const active = [...servers.values()];
  servers.clear();
  await Promise.all(active.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});
