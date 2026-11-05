/**
 * Drops this origin's push subscription, if the browser has one. Push is per address, so the new address subscribes afresh. The backend
 * keeps the old endpoint until the push service answers 410 or 404 on its next send, then drops it (postern server/internal/push/sender.go:380):
 * unsubscribing here is enough, nothing is told to the backend. Notify me has no setting of its own: it reads this subscription, so with it
 * gone Notify me is Off. Resolves false when the browser would not (or could not) unsubscribe.
 */
export async function turnNotifyOff(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    return true;
  } catch {
    return false;
  }
}
