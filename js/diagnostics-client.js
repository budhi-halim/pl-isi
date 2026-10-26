/** The regular product page has no recorder or persistent diagnostic storage. */
export function recordDiagnostic(event, details) {
  globalThis.plIsiDiagnostics?.record(event, details);
}
