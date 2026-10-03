// Module-level singleton that any screen can write to while a significant process is running
// (AI analysis, generation, etc.). AppShell reads this before navigating — if a block is set,
// it shows the confirmation banner instead of navigating immediately.
//
// Screens register with setNavigationBlock({ message, onCancel }) when a significant process
// starts, and clear it (setNavigationBlock(null)) when done or on unmount. The banner's CANCEL
// button calls onCancel() (to abort/reset the process) then navigates to the pending tab.

export type NavigationBlockInfo = {
  message: string;
  onCancel: () => void;
};

let currentBlock: NavigationBlockInfo | null = null;

export function setNavigationBlock(block: NavigationBlockInfo | null): void {
  currentBlock = block;
}

export function getNavigationBlock(): NavigationBlockInfo | null {
  return currentBlock;
}
