// First-run tutorial plumbing (components/TutorialOverlay.tsx renders it). Screens mark the
// element a step points at with `ref={tutorialTarget("id")}` (plus collapsable={false}, so
// Android keeps a real view to measure); Settings lets the tutorial open its FEEDBACK page.
import { useSyncExternalStore } from "react";
import type { View } from "react-native";

const targets = new Map<string, View>();
const refCallbacks = new Map<string, (r: View | null) => void>();

export function tutorialTarget(id: string): (r: View | null) => void {
  let cb = refCallbacks.get(id);
  if (!cb) {
    cb = (r: View | null) => { if (r) targets.set(id, r); else targets.delete(id); };
    refCallbacks.set(id, cb);
  }
  return cb;
}

export type Rect = { x: number; y: number; width: number; height: number };

export function measureTarget(id: string): Promise<Rect | null> {
  const v = targets.get(id);
  if (!v) return Promise.resolve(null);
  return new Promise(resolve => {
    v.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
  });
}

let settingsPageHandler: ((page: string) => void) | null = null;
export function setTutorialSettingsHandler(fn: ((page: string) => void) | null): void {
  settingsPageHandler = fn;
}
export function openSettingsPage(page: string): void {
  settingsPageHandler?.(page);
}

// ── Tour state shared with the app shell and the sample-showing screens ─────────────────────
// demo: My Closet / Outfits / Wardrobe show the sample closet (lib/tutorialSamples.ts) instead
//   of the account's own (often still empty) data, without touching that data.
// stage: the page is shrunk into a preview card at the top (App.tsx's ScreenArea) so the
//   tutorial text below it can never overlap anything on the page. null = normal size.

export type TutorialStage = { scale: number; top: number } | null;
type TourState = { demo: boolean; stage: TutorialStage };

let tour: TourState = { demo: false, stage: null };
const listeners = new Set<() => void>();
export function setTour(next: Partial<TourState>): void {
  tour = { ...tour, ...next };
  listeners.forEach(l => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useTutorialDemo(): boolean {
  return useSyncExternalStore(subscribe, () => tour.demo);
}
export function useTutorialStage(): TutorialStage {
  return useSyncExternalStore(subscribe, () => tour.stage);
}

// The shrunk page's own view, so a target's position can be measured within it and mapped into
// the card (measureTargetInStage).
let stageNode: View | null = null;
export function setStageNode(v: View | null): void { stageNode = v; }

// Target's rect as it appears on screen inside the preview card.
export function measureTargetInStage(id: string, stage: NonNullable<TutorialStage>, screenW: number): Promise<Rect | null> {
  const v = targets.get(id);
  if (!v || !stageNode) return Promise.resolve(null);
  return new Promise(resolve => {
    v.measureLayout(
      stageNode as never,
      (x, y, width, height) => resolve(width > 0 && height > 0 ? {
        x: screenW / 2 + stage.scale * (x - screenW / 2),
        y: stage.top + stage.scale * y,
        width: width * stage.scale,
        height: height * stage.scale,
      } : null),
      () => resolve(null),
    );
  });
}
