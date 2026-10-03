// Website tour state — same idea as the app's lib/tutorial.ts:
// demo: Closet / Outfits / Wardrobe show the sample closet (lib/client/tutorialSamples.ts) in place
//   of the account's own (often empty) data, without touching it.
import { useSyncExternalStore } from "react";

let demo = false;
const listeners = new Set<() => void>();
export function setTutorialDemo(v: boolean): void {
  demo = v;
  listeners.forEach(l => l());
}
export function useTutorialDemo(): boolean {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => demo,
    () => false,
  );
}
