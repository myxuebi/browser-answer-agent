import { t } from './i18n.mjs';
let writing = Promise.resolve();

export const logKey = (tabId) => `runLogs:${tabId}`;

export function writeLog(tabId, entry, clear = false) {
  const task = writing.then(async () => {
    const key = logKey(tabId);
    const stored = await chrome.storage.session.get(key);
    const entries = clear ? [] : [...(stored[key] ?? []), {
      time: Date.now(), kind: String(entry.kind || t('logRuntime')).slice(0, 40),
      text: String(entry.text ?? '').slice(0, 8000),
    }].slice(-300);
    await chrome.storage.session.set({ [key]: entries });
    if (!clear) chrome.tabs.sendMessage(tabId, { type: 'overlay-log', entry: entries.at(-1) }).catch(() => {});
    return entries;
  });
  writing = task.catch(() => {});
  return task;
}

export function createLogger(tabId) {
  return (kind, text) => {
    chrome.runtime.sendMessage({ type: 'log-append', tabId, entry: { kind, text } }).catch(() => {});
  };
}

export function logTime(time) {
  return new Date(time).toLocaleTimeString(t('locale'), { hour12: false });
}

export function renderLogs(container, entries) {
  const follow = container.scrollHeight - container.scrollTop - container.clientHeight < 45;
  container.replaceChildren(...entries.map((entry) => {
    const row = document.createElement('div');
    row.className = 'log-entry';
    const label = document.createElement('span');
    label.className = 'log-label';
    label.textContent = `${logTime(entry.time)} · ${entry.kind}`;
    const body = document.createElement('div');
    body.textContent = entry.text;
    row.append(label, body);
    return row;
  }));
  if (follow) container.scrollTop = container.scrollHeight;
}
