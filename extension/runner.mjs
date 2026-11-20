export async function ensureActive(tab, signal) {
  signal.throwIfAborted();
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  signal.throwIfAborted();
  if (active?.id !== tab.id) throw new Error('当前标签页已切换，已停止操作。');
}

export const siteAccessHint = '请在浏览器的扩展详情中将「站点访问权限」设为「在所有网站上」。';

export function isRestrictedPage(url) {
  if (!url) return false;
  const { protocol, hostname, pathname } = new URL(url);
  return !['http:', 'https:'].includes(protocol) || hostname === 'chromewebstore.google.com' ||
    (hostname === 'chrome.google.com' && pathname.startsWith('/webstore')) ||
    (hostname === 'microsoftedge.microsoft.com' && pathname.startsWith('/addons'));
}

function pageAccessError(error, url) {
  if (isRestrictedPage(url) || /cannot access (?:a |urls with |contents of (?:the )?url ["']?)(?:chrome|edge|about|devtools|file)(?:-extension)?:|extensions gallery|protected (?:page|url)/i.test(error.message)) {
    return new Error('此页受浏览器保护或不是普通网页。请在 HTTP 或 HTTPS 网页上使用。');
  }
  if (/cannot access|host permission|access.*denied/i.test(error.message)) {
    return new Error(url
      ? `浏览器未允许插件读取此页。${siteAccessHint}扩展商店和浏览器内部页面仍不支持。`
      : `此页可能受浏览器保护，或未授予站点访问权限。若是普通网页，${siteAccessHint}`);
  }
  return new Error('无法读取此页。页面可能刚刚切换或重新加载，请等加载完成后重试。');
}

export async function scanPage(tab, settings, documentId) {
  try {
    const injections = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, files: ['html-agent.js'],
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
    if (!snapshot.html) throw new Error('无法读取页面。');
    return { documentId: documentId || injections.find((entry) => entry.frameId === 0)?.documentId, result: snapshot };
  } catch (error) {
    throw pageAccessError(error, tab.url);
  }
}

export async function applyAnswer(tabId, documentId, snapshot, answer, log = () => {}, signal) {
  const groups = new Map();
  for (const action of answer.actions) {
    const route = snapshot.routes[action.target];
    if (!route) throw new Error('模型返回了未提供的元素。');
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
    const description = `${original.target} · ${target?.text || target?.tag || '元素'}`;
    log(action.type === 'fill' ? '输入计划' : '点击计划', `${action.type === 'fill' ? '输入：' + action.value : action.selected === false ? '取消选中' : action.selected === true ? '选中' : '点击'}：${description}`);
    const args = { token: group.token, actions: [action] };
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [frameDocument] },
      func: (request) => globalThis.__htmlAnswerAgent?.apply(request), args: [args],
    });
    if (!entry?.result) throw new Error('无法核对此题执行结果，页面可能已切换或重新加载。');
    const names = { applied: action.type === 'fill' ? '已输入并核对内容' : '已点击并核对选中状态', clicked: '已点击，页面未提供选中状态', unchanged: '已符合目标状态，无需操作', skipped: '已跳过', partial: '操作结果待核对' };
    log(action.type === 'fill' ? '输入结果' : '点击结果', `${description}\n${names[entry.result.state] || entry.result.state}${entry.result.detail ? '：' + entry.result.detail : ''}`);
    if (['skipped', 'partial'].includes(entry.result.state)) return entry.result;
    if (entry.result.state === 'clicked' || (result.state !== 'clicked' && entry.result.state === 'applied')) result = entry.result;
    }
  }
  return result;
}

export function imageNotice(snapshot, settings) {
  if (!snapshot.skippedImages) return '';
  return settings.vision ? `${snapshot.skippedImages} 张图片未能读取或超出图片限额`
    : `未发送 ${snapshot.skippedImages} 张图片，可在模型设置中开启读图`;
}

export async function showOverlay(tab, mode) {
  try {
    const [{ documentId }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
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
