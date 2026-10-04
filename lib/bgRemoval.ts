import { removeBackground } from "@imgly/background-removal-node";

// One background removal at a time, server-wide. Each run peaks at ~925 MB of memory (the ONNX
// model), so two at once pushed the Railway container past its limit and the whole server was
// killed mid-request ("Killed" in the deploy logs), taking every user's requests down with it.
// Extra requests wait their turn; past MAX_WAITING they fail fast instead, and every caller
// already falls back to the original image when removal fails.
const MAX_WAITING = 6;
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;

export class BgRemovalBusyError extends Error {
  constructor() { super("Background removal is busy"); this.name = "BgRemovalBusyError"; }
}

export function removeBackgroundQueued(input: Blob): Promise<Blob> {
  if (waiting >= MAX_WAITING) return Promise.reject(new BgRemovalBusyError());
  waiting++;
  const run = chain.then(
    () => removeBackground(input, { model: "medium", output: { format: "image/png" } }),
  );
  chain = run.catch(() => {}).finally(() => { waiting--; });
  return run;
}
