import { Room, Server } from "colyseus";

const port = Number.parseInt(process.env.REALTIME_PORT ?? "2567", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("REALTIME_PORT must be a valid TCP port");
}

class WorkspaceRoom extends Room {
  /**
   * Colyseus 0.16 prefers the static authentication hook. Keep this room
   * joinable while it is only a foundation endpoint: it exposes no shared
   * state or write operations yet, so there is no instance-level onAuth.
   *
   * IMPORTANT: Before adding workspace data or mutations, replace this
   * permissive hook with real server-side session and workspace-membership
   * validation. Do not treat a client-provided token as verified by itself.
   */
  static onAuth(_token, _options, _context) {
    return true;
  }

  onCreate() {
    // Shared writes stay disabled until auth and membership checks are implemented.
    this.setMetadata({ service: "teamspace-realtime", status: "foundation" });
  }
}

// Let Colyseus create and manage its HTTP/WebSocket transport. Passing { port }
// directly to WebSocketTransport is invalid for the installed Colyseus 0.16 API.
const gameServer = new Server();
gameServer.define("workspace", WorkspaceRoom);
gameServer.onShutdown(() => console.info("TeamSpace real-time service stopped"));

await gameServer.listen(port);
console.info(`TeamSpace real-time service listening on port ${port}`);
