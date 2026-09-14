import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Address, Channel, Inbound } from "./channel";

/**
 * The console channel: a rehearsal of the bot in a terminal (docs/heartbeat-bot-plan.md §6.4). Every
 * line typed is an inbound message from the chosen person; replies print below. No WhatsApp, no message
 * budget, the same agent turns as the real channel.
 */

export interface ConsoleChannelOptions {
  /** The person id the typed lines come from (the address on this channel). */
  as: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** The prompt shown before each line (default: the person id). */
  promptHe?: string;
}

export function createConsoleChannel(opts: ConsoleChannelOptions): Channel & { address: Address } {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const address: Address = { channel: "console", address: opts.as };
  let rl: ReturnType<typeof createInterface> | null = null;
  const prompt = () => rl?.prompt();
  return {
    id: "console",
    address,
    async send(to, text) {
      const head = to.address === opts.as ? "שרגא" : `שרגא → ${to.address}`;
      output.write(`\n${head}:\n${text}\n\n`);
      prompt();
      return { providerMessageId: randomUUID() };
    },
    start(onInbound: (m: Inbound) => void) {
      rl = createInterface({ input, output, terminal: false });
      rl.setPrompt(`${opts.promptHe ?? opts.as}> `);
      rl.on("line", (line) => {
        const text = line.trim();
        if (!text) {
          prompt();
          return;
        }
        onInbound({ id: randomUUID(), from: address, text, at: new Date().toISOString() });
      });
      prompt();
      return () => {
        rl?.close();
        rl = null;
      };
    },
  };
}
