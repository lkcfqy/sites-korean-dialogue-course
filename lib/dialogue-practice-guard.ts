/** A failed write protects the in-memory answer until an actual write succeeds. */
export function createPracticeDraftGuard() {
  let failed = false;
  return {
    track<T extends { saved: boolean }>(result: T): T {
      failed = !result.saved;
      return result;
    },
    canLeave: () => !failed,
  };
}
