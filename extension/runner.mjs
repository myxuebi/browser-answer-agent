import { t } from './i18n.mjs';
export async function ensureActive(tab, signal) {
  signal.throwIfAborted();
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  signal.throwIfAborted();
  if (active?.id !== tab.id) throw new Error(t('activeTabChanged'));
}

export const siteAccessHint = t('siteAccess');

export function isRestrictedPage(url) {
  if (!url) return false;
  const { protocol, hostname, pathname } = new URL(url);
  return !['http:', 'https:'].includes(protocol) || hostname === 'chromewebstore.google.com' ||
    (hostname === 'chrome.google.com' && pathname.startsWith('/webstore')) ||
    (hostname === 'microsoftedge.microsoft.com' && pathname.startsWith('/addons'));
}

function pageAccessError(error, url) {
  if (isRestrictedPage(url) || /cannot access (?:a |urls with |contents of (?:the )?url ["']?)(?:chrome|edge|about|devtools|file)(?:-extension)?:|extensions gallery|protected (?:page|url)/i.test(error.message)) {
    return new Error(t('protectedPage'));
  }
  if (/cannot access|host permission|access.*denied/i.test(error.message)) {
    return new Error(url
      ? t('pageAccessDenied', siteAccessHint)
      : t('pageAccessUnknown', siteAccessHint));
  }
  return new Error(t('pageReadFailed'));
}

export async function scanPage(tab, settings, documentId) {
  try {
    const injections = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, files: ['i18n.js', 'html-agent.js'],
    });
    const entries = await chrome.scripting.executeScript({
      target: { tabId: tab.id, documentIds: injections.map((entry) => entry.documentId) },
      func: (options) => globalThis.__htmlAnswerAgent?.scan(options),
      args: [{ vision: settings.vision }],
    });
    const snapshot = { html: '', targets: [], images: [], routes: {}, urls: [], skippedImages: 0, truncated: false };
    let total = 0;
    for (const entry of entries.sort((first, second) => first.frameId - second.frameId)) {
      const source = entry.result;
      if (!source?.html) continue;
      if (total + source.html.length > 320000) {
        snapshot.truncated = true;
        continue;
      }
      total += source.html.length;
      const prefix = `f${entry.frameId}_`;
      snapshot.urls.push(source.url || '');
      snapshot.html += `<agent-frame id="f${entry.frameId}">${source.html.replace(/data-agent-id="(e\d+)"/g, (_, id) => `data-agent-id="${prefix}${id}"`)}</agent-frame>\n`;
      for (const target of source.targets) {
        const id = prefix + target.id;
        snapshot.targets.push({ ...target, id });
        snapshot.routes[id] = { target: target.id, token: source.token, documentId: entry.documentId };
      }
      for (const image of source.images) {
        if (snapshot.images.length < 6) snapshot.images.push({ ...image, element: prefix + image.element });
        else snapshot.skippedImages += 1;
      }
      snapshot.skippedImages += source.skippedImages;
      snapshot.truncated ||= source.truncated;
    }
    if (!snapshot.html) throw new Error(t('cannotRead'));
    return { documentId: documentId || injections.find((entry) => entry.frameId === 0)?.documentId, result: snapshot };
  } catch (error) {
    throw pageAccessError(error, tab.url);
  }
}

export async function applyAnswer(tabId, documentId, snapshot, answer, log = () => {}, signal) {
  const groups = new Map();
  for (const action of answer.actions) {
    const route = snapshot.routes[action.target];
    if (!route) throw new Error(t('unknownTarget'));
    const group = groups.get(route.documentId) ?? { token: route.token, actions: [] };
    group.actions.push({ ...action, target: route.target });
    groups.set(route.documentId, group);
  }
  let result = { state: 'unchanged' };
  for (const [frameDocument, group] of groups) {
    for (const action of group.actions) {
    signal?.throwIfAborted();
    const original = answer.actions.find((item) => snapshot.routes[item.target].target === action.target &&
      snapshot.routes[item.target].documentId === frameDocument);
    const target = snapshot.targets.find((item) => item.id === original.target);
    const description = `${original.target} · ${target?.text || target?.tag || t('element')}`;
    log(action.type === 'fill' ? t('logInputPlan') : t('logClickPlan'), `${action.type === 'fill' ? t('inputPrefix') + action.value : action.selected === false ? t('deselect') : action.selected === true ? t('select') : t('click')}：${description}`);
    const args = { token: group.token, actions: [action] };
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [frameDocument] },
      func: (request) => globalThis.__htmlAnswerAgent?.apply(request), args: [args],
    });
    if (!entry?.result) throw new Error(t('verifyFailed'));
    const names = { applied: action.type === 'fill' ? t('inputVerified') : t('clickVerified'), clicked: t('clickUnverified'), unchanged: t('alreadyMatches'), skipped: t('actionSkipped'), partial: t('actionUnverified') };
    log(action.type === 'fill' ? t('logInputResult') : t('logClickResult'), `${description}\n${names[entry.result.state] || entry.result.state}${entry.result.detail ? '：' + entry.result.detail : ''}`);
    if (['skipped', 'partial'].includes(entry.result.state)) return entry.result;
    if (entry.result.state === 'clicked' || (result.state !== 'clicked' && entry.result.state === 'applied')) result = entry.result;
    }
  }
  return result;
}

export function imageNotice(snapshot, settings) {
  if (!snapshot.skippedImages) return '';
  return settings.vision ? t('imagesUnavailable', snapshot.skippedImages)
    : t('imagesNotSent', snapshot.skippedImages);
}

export async function showOverlay(tab, mode) {
  try {
    const [{ documentId }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['i18n.js', 'overlay.js'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, documentIds: [documentId] },
      func: (display) => globalThis.__answerAgentOverlay?.show(display), args: [mode],
    });
  } catch (error) {
    throw pageAccessError(error, tab.url);
  }
}

export async function removeOverlay(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId }, func: () => globalThis.__answerAgentOverlay?.show('sidebar'),
  }).catch(() => {});
}
