const recorder = globalThis.plIsiDiagnostics;
const copy = document.querySelector('#copy-diagnostic-log');
const download = document.querySelector('#download-diagnostic-log');
const status = document.querySelector('#diagnostic-status');
const downloads = new Map();

function exportLog(action) {
  recorder.record('log-export', { action });
  return JSON.stringify(recorder.snapshot(), null, 2);
}

if (!recorder) {
  copy.disabled = true; download.disabled = true;
  status.textContent = 'Recording could not start. Reload this page to try again.';
} else {
  copy.addEventListener('click', async () => {
    if (copy.disabled) return;
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(exportLog('copy'));
      status.textContent = 'Log copied. Paste it into the chat.';
      recorder.record('log-copied');
    } catch (error) {
      status.textContent = 'Couldn’t copy the log. Use Download log instead.';
      recorder.record('log-copy-failed', { name: error.name, message: error.message });
    } finally { copy.disabled = false; }
  });
  download.addEventListener('click', () => {
    let url;
    const link = document.createElement('a');
    try {
      const blob = new Blob([exportLog('download')], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      link.href = url; link.download = `pl-isi-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.hidden = true; document.body.append(link); link.click();
      downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000));
      status.textContent = 'Log downloaded. Recording continues for this page session.';
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      status.textContent = 'Couldn’t download the log. Use Copy log instead.';
      recorder.record('log-download-failed', { name: error.name, message: error.message });
    } finally { link.remove(); }
  });
}
window.addEventListener('pagehide', () => { for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); } downloads.clear(); });
