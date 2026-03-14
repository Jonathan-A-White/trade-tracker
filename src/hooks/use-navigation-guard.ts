import { useEffect, useCallback } from "react";
import { useBlocker } from "react-router";

export function useNavigationGuard(when: boolean, message: string): void {
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (!when) return;
      e.preventDefault();
    },
    [when],
  );

  useEffect(() => {
    if (when) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [when, handleBeforeUnload]);

  const blocker = useBlocker(when);

  useEffect(() => {
    if (blocker.state === "blocked") {
      const confirmed = window.confirm(message);
      if (confirmed) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker, message]);
}
