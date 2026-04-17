export function log(level: string, msg: string, extra?: Record<string, unknown>): void {
  const entry = { level, time: new Date().toISOString(), msg, ...extra };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}
