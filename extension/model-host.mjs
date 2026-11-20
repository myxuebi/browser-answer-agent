import { t, localize, initializeLocale } from './i18n.mjs';
initializeLocale().then(() => localize(document)).catch(console.error);
const worker = new Worker('model-worker.mjs?locale=' + new URLSearchParams(location.search).get('locale'), { type: 'module' });
const pending = new Map();
let heartbeat;

function finish(id, response) {
  const reply = pending.get(id);
  pending.delete(id);
  if (!pending.size) clearInterval(heartbeat);
  reply?.(response);
}

worker.onmessage = ({ data: { id, ...response } }) => {
  if (response.entry) {
    if (pending.has(id)) chrome.runtime.sendMessage({ type: 'model-log', id, entry: response.entry }).catch(() => {});
    return;
  }
  finish(id, response);
};
worker.onerror = () => {
  for (const id of pending.keys()) finish(id, { error: t('modelHostFailed') });
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('background.js')) return;
  if (message?.type === 'model-cancel') {
    worker.postMessage({ id: message.id, cancel: true });
    return;
  }
  if (message?.type !== 'model-request' || pending.has(message.id)) return;
  if (!pending.size) heartbeat = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'model-heartbeat' }).catch(() => {});
  }, 20000);
  pending.set(message.id, reply);
  worker.postMessage({ id: message.id, settings: message.settings, snapshot: message.snapshot });
  return true;
});
