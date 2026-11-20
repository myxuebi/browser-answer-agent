import { t } from './i18n.mjs';
import { loadSettings, parseSettings } from './model.mjs';
import { writeLog } from './logs.mjs';
import { runQuiz } from './quiz-loop.mjs';
import { ensureActive, removeOverlay, showOverlay, siteAccessHint } from './runner.mjs';

const modes = { sidebar: t('openSidebar'), floating: t('showFloating'), dot: t('showDot') };
const running = new Map();
let creatingHost;

function updateMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title] of Object.entries(modes)) chrome.contextMenus.create({ id, title, contexts: ['action'] });
  });
}

chrome.runtime.onInstalled.addListener(updateMenus);
chrome.runtime.onStartup.addListener(updateMenus);

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});

chrome.contextMenus.onClicked.addListener(({ menuItemId }, tab) => {
  if (!tab || !Object.hasOwn(modes, menuItemId)) return;
  if (menuItemId === 'sidebar') {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    removeOverlay(tab.id);
  } else {
    showOverlay(tab, menuItemId).catch(console.error);
  }
});

async function createModelHost() {
  if (creatingHost) return creatingHost;
  creatingHost = (async () => {
    const hostUrl = 'model-host.html?locale=' + t('locale');
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(hostUrl)],
    });
    if (!existing.length) await chrome.offscreen.createDocument({
      url: hostUrl, reasons: ['WORKERS'], justification: t('offscreenReason'),
    });
  })();
  try {
    await creatingHost;
  } finally {
    creatingHost = null;
  }
}

async function runOverlay(tab, documentId, controller, update, mode) {
  const { signal } = controller;
  const log = (kind, text) => { writeLog(tab.id, { kind, text }).catch(() => {}); };
  log(t('logStart'), t('overlayTaskStart'));
  await ensureActive(tab, signal);
  const stored = await loadSettings();
  if (!stored.endpoint || !stored.model) throw new Error(t('modelNotConfigured'));
  const settings = parseSettings(stored);
  if (!await chrome.permissions.contains({ origins: [settings.permission] })) throw new Error(siteAccessHint);
  await createModelHost();
  const ask = async (snapshot) => {
    signal.throwIfAborted();
    const id = crypto.randomUUID();
    controller.modelRequestId = id;
    const cancel = () => chrome.runtime.sendMessage({ type: 'model-cancel', id }).catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    let response;
    try { response = await chrome.runtime.sendMessage({ type: 'model-request', id, settings, snapshot }); }
    finally { controller.modelRequestId = undefined; signal.removeEventListener('abort', cancel); }
    signal.throwIfAborted();
    if (!response?.result) throw new Error(response?.error || t('noModelResult'));
    return response.result;
  };
  return runQuiz({
    tab, settings, controller, log, status: update, ask,
    onPage: async () => {
      if (mode) {
        await showOverlay(await chrome.tabs.get(tab.id), mode);
        await chrome.tabs.sendMessage(tab.id, { type: 'overlay-state', busy: true, status: t('answeringContinuously') }).catch(() => {});
      }
    },
  });
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (sender.url === chrome.runtime.getURL('panel.html') &&
      ['log-append', 'log-clear'].includes(message?.type) && Number.isInteger(message.tabId)) {
    writeLog(message.tabId, message.entry ?? {}, message.type === 'log-clear')
      .then(() => reply(true), () => reply(false));
    return true;
  }
  if (!sender.tab && sender.url?.split('?')[0] === chrome.runtime.getURL('model-host.html') && message?.type === 'model-log') {
    for (const [tabId, { controller }] of running) {
      if (controller.modelRequestId === message.id) writeLog(tabId, message.entry).catch(() => {});
    }
    return;
  }
  if (message?.type === 'model-heartbeat' && !sender.tab && sender.url?.split('?')[0] === chrome.runtime.getURL('model-host.html')) {
    reply(true);
    return;
  }
  const tab = sender.tab;
  if (!tab || sender.frameId !== 0 || !sender.documentId) return;
  if (message?.type === 'overlay-stop') {
    const current = running.get(tab.id);
    current?.controller.abort(new Error(t('stopActions')));
    reply(true);
    return;
  }
  if (message?.type !== 'overlay-start') return;
  if (running.has(tab.id)) {
    reply({ error: t('taskAlreadyRunning') });
    return;
  }
  const controller = new AbortController();
  running.set(tab.id, { controller, documentId: sender.documentId, windowId: tab.windowId });
  const update = (status) => {
    writeLog(tab.id, { kind: t('logRuntime'), text: status }).catch(() => {});
    chrome.tabs.sendMessage(tab.id, { type: 'overlay-progress', status }).catch(() => {});
  };
  runOverlay(tab, sender.documentId, controller, update, ['floating', 'dot'].includes(message.mode) ? message.mode : 'floating')
    .then((status) => {
      writeLog(tab.id, { kind: t('logDone'), text: status }).catch(() => {});
      chrome.tabs.sendMessage(tab.id, { type: 'overlay-state', busy: false, status }).catch(() => {});
      reply({ status });
    }, (error) => {
      writeLog(tab.id, { kind: t('logError'), text: error.message }).catch(() => {});
      chrome.tabs.sendMessage(tab.id, { type: 'overlay-state', busy: false, status: error.message, error: true }).catch(() => {});
      reply({ error: error.message });
    })
    .finally(() => running.delete(tab.id));
  return true;
});

function stopTab(tabId) {
  running.get(tabId)?.controller.abort(new Error(t('taskPageChanged')));
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  for (const [id, task] of running) if (task.windowId === windowId && id !== tabId) stopTab(id);
});
chrome.tabs.onRemoved.addListener(stopTab);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if ((change.status === 'loading' || change.url) && !running.get(tabId)?.controller.navigating) stopTab(tabId);
});
