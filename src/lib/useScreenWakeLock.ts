import { useEffect } from "react";

export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let wakeLock: WakeLockSentinel | null = null;
    let requestPending = false;
    let disposed = false;

    const requestWakeLock = async () => {
      if (
        disposed ||
        requestPending ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      requestPending = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (disposed) {
          await sentinel.release();
          return;
        }

        wakeLock = sentinel;
        sentinel.addEventListener(
          "release",
          () => {
            if (wakeLock === sentinel) wakeLock = null;
          },
          { once: true }
        );
      } catch {
        // Wake locks may be unavailable due to browser support or device policy.
      } finally {
        requestPending = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void requestWakeLock();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLock) void wakeLock.release();
    };
  }, [active]);
}