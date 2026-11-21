export type Key = "up" | "down" | "enter" | "esc" | "quit";

export interface KeyReader {
  stop: () => void;
}

export function startKeys(onKey: (k: Key) => void): KeyReader {
  let stopped = false;
  const stdin = process.stdin as unknown as { setRawMode?: (b: boolean) => void };
  let rawOk = false;
  try {
    stdin.setRawMode?.(true);
    rawOk = true;
  } catch {
    rawOk = false;
  }
  if (!rawOk || !process.stdout.isTTY) {
    throw new Error("no-tty");
  }
  const reader = Bun.stdin.stream().getReader();
  const dec = new TextDecoder();
  let buf = "";

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        buf += dec.decode(value, { stream: true });
        while (buf.length > 0 && !stopped) {
          if (buf.startsWith("\x1b[A")) {
            buf = buf.slice(3);
            onKey("up");
            continue;
          }
          if (buf.startsWith("\x1b[B")) {
            buf = buf.slice(3);
            onKey("down");
            continue;
          }
          if (buf.startsWith("\x1b[C") || buf.startsWith("\x1b[D")) {
            buf = buf.slice(3);
            continue;
          }
          const c = buf[0]!;
          if (c === "\r" || c === "\n") {
            buf = buf.slice(1);
            onKey("enter");
            continue;
          }
          if (c === "q" || c === "Q" || c === "\x03") {
            buf = buf.slice(1);
            onKey("quit");
            continue;
          }
          if (c === "\x1b") {
            if (buf.length === 1) {
              buf = "";
              onKey("esc");
            } else {
              buf = buf.slice(1);
            }
            continue;
          }
          buf = buf.slice(1);
        }
      }
    } catch {
      /* stdin closed */
    }
  })();

  return {
    stop() {
      stopped = true;
      try {
        void reader.cancel();
      } catch {
        /* already cancelled */
      }
      try {
        stdin.setRawMode?.(false);
      } catch {
        /* not raw */
      }
    },
  };
}

export function waitAnyKey(): Promise<Key> {
  return new Promise((resolve) => {
    const r = startKeys((k) => {
      r.stop();
      resolve(k);
    });
  });
}
