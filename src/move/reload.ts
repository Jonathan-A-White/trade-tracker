/** Reloads the app, so every screen reads the phone as the restore left it. A module of its own so a test can stand in for it. */
export function reloadPage(): void {
  location.reload();
}
