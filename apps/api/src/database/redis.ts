import { createClient } from "redis";

export interface RedisCommands {
  command(args: string[]): Promise<unknown>;
}
export type OperationalLog = (message: string) => void;

// One connection owned by the startup composition root. No queued offline writes.
export async function createRedisResources(url: string, log: OperationalLog = console.warn) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: (retries) => Math.min(100 * (retries + 1), 3000),
    },
  });
  // Do not log connection errors verbatim: URLs may contain credentials.
  let reported = false;
  client.on("error", () => {
    if (!reported) {
      reported = true;
      log("Redis unavailable; optional operations fail open.");
    }
  });
  client.on("ready", () => {
    reported = false;
  });
  let closing = false;
  const commands: RedisCommands = {
    async command(args) {
      if (!client.isReady) throw new Error("Redis unavailable");
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        // Client abort signals alone only cover queued commands, not socket replies.
        return await Promise.race([
          client.sendCommand(args),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => {
              reject(new Error("Redis command deadline exceeded"));
              if (client.isOpen) client.destroy();
              if (!closing)
                void client.connect().catch(() => {
                  log("Redis reconnect failed; optional operations fail open.");
                });
            }, 500);
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect().then(() => commands.command(["PING"])),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Redis startup timeout")), 1500);
      }),
    ]);
  } catch {
    log("Redis startup degraded; reconnect continues in background.");
  } finally {
    clearTimeout(timer);
  }
  return {
    commands,
    async close(): Promise<void> {
      closing = true;
      if (!client.isOpen) return;
      if (!client.isReady) {
        client.destroy();
        return;
      }
      const deadline = setTimeout(() => {
        if (client.isOpen) client.destroy();
      }, 1000);
      try {
        await client.close();
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}
