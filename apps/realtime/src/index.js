import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";

const port = Number.parseInt(process.env.REALTIME_PORT ?? "2567", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("REALTIME_PORT must be a valid TCP port");

class WorkspaceRoom {
  onCreate() {
    // Shared writes stay disabled until auth and membership checks are implemented.
    this.setMetadata({ service: "teamspace-realtime", status: "foundation" });
  }
}
const gameServer = new Server({ transport: new WebSocketTransport({ port }) });
gameServer.define("workspace", WorkspaceRoom);
gameServer.onShutdown(() => console.info("TeamSpace real-time service stopped"));
await gameServer.listen();
console.info(`TeamSpace real-time service listening on port ${port}`);
