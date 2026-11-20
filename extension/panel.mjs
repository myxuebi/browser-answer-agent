import { loadSettings, parseSettings, requestAnswers } from './model.mjs';
import { createLogger, logKey, logTime, renderLogs } from './logs.mjs';
import { askModel, runQuiz } from './quiz-loop.mjs';
import { applyAnswer, ensureActive, imageNotice, isRestrictedPage, removeOverlay, scanPage, showOverlay, siteAccessHint } from './runner.mjs';

const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'preview', 'auto', 'stop', 'apply', 'settings-panel', 'settings-form', 'settings-fields', 'model-badge',
  'page-name', 'endpoint', 'model', 'key', 'status', 'results', 'coverage', 'questions', 'api', 'effort', 'vision', 'launcher', 'summary',
  'run-logs', 'log-count', 'log-copy', 'log-clear',
].map((id) => [id, byId(id)]));
const outcomeNames = { applied: '已选中', unchanged: '已是建议答案', clicked: '已点击，未核对', partial: '已点击，结果待核对', skipped: '未点击' };

let windowId;
let settings;
let ready = false;
let saving = false;
let operation;
let plan;
let pageRevision = 0;
let logTabId;
let logEntries = [];
let log = () => {};

function showLogs(entries) {
  logEntries = entries;
  renderLogs(ui['run-logs'], entries);
  ui['log-count'].textContent = `${entries.length} 条`;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && logTabId !== undefined && changes[logKey(logTabId)]) {
    showLogs(changes[logKey(logTabId)].newValue ?? []);
  }
});

ui['log-clear'].addEventListener('click', async () => {
  if (logTabId === undefined) return;
  try { await chrome.runtime.sendMessage({ type: 'log-clear', tabId: logTabId }); }
  catch { status('无法清空日志，请重新加载插件。', true); }
});
ui['log-copy'].addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logEntries.map((entry) => `[${logTime(entry.time)}] [${entry.kind}] ${entry.text}`).join('\n'));
    status('日志已复制。');
  } catch { status('浏览器未允许复制，请手动选择日志文字。', true); }
});

function status(message, error = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', error);
  log(error ? '错误' : '运行', message);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab;
}

async function showTab() {
  const revision = ++pageRevision;
  const tab = await activeTab();
  if (revision !== pageRevision) return;
  if (logTabId !== tab?.id) {
    logTabId = tab?.id;
    const currentId = logTabId;
    const entries = currentId === undefined ? {} : await chrome.storage.session.get(logKey(currentId));
    if (revision !== pageRevision) return;
    showLogs(entries[logKey(currentId)] ?? []);
  }
  const label = isRestrictedPage(tab?.url) ? '当前标签页不是可读取的普通网页。'
    : tab?.title || `暂时读不到网页标题。${siteAccessHint}`;
  ui['page-name'].textContent = label;
  ui['page-name'].title = label;
}

function refreshControls() {
  const locked = !ready || Boolean(operation) || saving;
  ui.preview.disabled = locked;
  ui.auto.disabled = locked;
  ui.stop.hidden = !operation;
  ui.stop.disabled = Boolean(operation?.signal.aborted);
  ui['settings-fields'].disabled = locked;
  for (const button of ui.launcher.querySelectorAll('button')) button.disabled = locked;
  ui.apply.hidden = !plan || plan.used || !plan.answers.length;
  ui.apply.disabled = locked || !plan?.answers.some((answer) => plan.cards.get(answer.question).checkbox.checked);
  for (const { checkbox } of plan?.cards.values() ?? []) if (checkbox) checkbox.disabled = locked || plan.used;
}

function clearPlan() {
  plan = null;
  ui.results.hidden = true;
  ui.questions.replaceChildren();
  refreshControls();
}

function invalidateTab(tabId) {
  if (operation?.navigating && tabId === operation.tabId) return;
  const message = '标签页或页面已改变。请在目标网页重新分析。';
  if (operation?.tabId !== undefined && (tabId === undefined || tabId === operation.tabId)) {
    operation.abort(new Error(message));
    refreshControls();
  }
  if (plan && (tabId === undefined || tabId === plan.tabId)) {
    clearPlan();
    status(message);
  }
}

function formValues() {
  return { endpoint: ui.endpoint.value, model: ui.model.value, key: ui.key.value,
    api: ui.api.value, effort: ui.effort.value, vision: ui.vision.checked, summary: ui.summary.checked };
}

function updateModelBadge() {
  ui['model-badge'].textContent = settings?.model || '未配置';
}

ui.endpoint.addEventListener('input', () => {
  if (!settings?.key) return;
  try {
    if (new URL(ui.endpoint.value.trim()).origin === new URL(settings.endpoint).origin) return;
  } catch { }
  if (ui.key.value.trim() === settings.key) ui.key.value = '';
});

ui['settings-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (operation || saving) return;
  try {
    const next = parseSettings(formValues());
    if (settings?.key && next.key === settings.key && new URL(next.endpoint).origin !== new URL(settings.endpoint).origin) {
      throw new Error('接口域名已变更。请清空旧 API Key，或输入新服务的 Key。');
    }
    saving = true;
    refreshControls();
    const { endpoint, model, api, effort, vision, summary } = next;
    await chrome.storage.local.set({
      modelSettings: { endpoint, model, api, effort, vision, summary },
      modelKey: { endpoint, key: next.key },
    });
    await chrome.storage.session.remove('modelKey');
    settings = next;
    updateModelBadge();
    clearPlan();
    ui['settings-panel'].open = false;
    status('模型设置已保存。可以开始分析当前网页。');
  } catch (error) {
    status(error.message, true);
  } finally {
    saving = false;
    refreshControls();
  }
});

function renderPlan(tab, documentId, snapshot, result) {
  const { answers, rejected } = result;
  plan = { tabId: tab.id, tab, documentId, snapshot, answers, cards: new Map(), used: false, imageNote: imageNotice(snapshot, settings) };
  const accepted = new Map(answers.map((answer) => [answer.question, answer]));
  const cards = result.questions.map((question, index) => {
    const answer = accepted.get(question.id);
    const card = document.createElement('article');
    card.className = 'question';
    const title = document.createElement(answer ? 'label' : 'strong');
    const text = document.createElement('span');
    text.textContent = `${index + 1}. ${question.prompt}`;
    let checkbox;
    if (answer) {
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.addEventListener('change', refreshControls);
      title.append(checkbox);
    }
    title.append(text);
    card.append(title);
    if (answer) {
      const list = document.createElement('ul');
      for (const option of question.options.filter(({ id }) => answer.options.includes(id))) {
        const item = document.createElement('li');
        item.textContent = option.text;
        list.append(item);
      }
      card.append(list);
      if (answer.reason) {
        const reason = document.createElement('p');
        reason.textContent = answer.reason;
        card.append(reason);
      }
    }
    const outcome = document.createElement('p');
    outcome.className = 'outcome';
    outcome.hidden = Boolean(answer);
    if (!answer) outcome.textContent = '模型没有给出可执行的建议，已跳过。';
    card.append(outcome);
    plan.cards.set(question.id, { checkbox, outcome });
    return card;
  });
  ui.questions.replaceChildren(...cards);
  ui.coverage.textContent = `${answers.length} 题 · AI 识别`;
  ui.results.hidden = false;
  const notes = [snapshot.truncated && 'HTML 超出上限，已发送部分页面', rejected > 0 && `已忽略 ${rejected} 条无效回复`, plan.imageNote].filter(Boolean);
  const summary = answers.length ? `AI 已从 HTML 识别并给出 ${answers.length} 题建议。` : result.message || 'AI 未给出可执行的答案。';
  status(notes.length ? `${summary}${notes.join('；')}。` : summary);
  refreshControls();
  return plan;
}

async function applyPlan(current, controller) {
  await ensureActive(current.tab, controller.signal);
  const selected = current.answers.filter((answer) => current.cards.get(answer.question).checkbox.checked);
  if (!selected.length) return;
  current.used = true;
  refreshControls();
  const counts = { verified: 0, clicked: 0, skipped: 0 };
  let completed = 0;
  try {
    for (const answer of selected) {
      await ensureActive(current.tab, controller.signal);
      status(`正在应用第 ${completed + 1} / ${selected.length} 题…`);
      const outcome = await applyAnswer(current.tabId, current.documentId, current.snapshot, answer, log, controller.signal);
      const { state, detail } = outcome;
      const record = current.cards.get(answer.question).outcome;
      record.textContent = detail ? `${outcomeNames[state]}：${detail}` : outcomeNames[state];
      record.hidden = false;
      if (state === 'applied' || state === 'unchanged') counts.verified += 1;
      else if (state === 'clicked' || state === 'partial') counts.clicked += 1;
      else counts.skipped += 1;
      completed += 1;
    }
    controller.signal.throwIfAborted();
  } catch (error) {
    throw new Error(`${error.message} 已核对 ${counts.verified} 题，另有 ${counts.clicked} 题点击结果待核对。`);
  }
  status(`已核对 ${counts.verified} 题，点击结果待核对 ${counts.clicked} 题，跳过 ${counts.skipped} 题。插件未点击提交。${current.imageNote ? current.imageNote + '。' : ''}`);
}

async function run(work) {
  if (!ready || operation || saving) return;
  const controller = new AbortController();
  operation = controller;
  refreshControls();
  try {
    await work(controller);
  } catch (error) {
    status(error.name === 'AbortError' ? controller.signal.reason?.message || '已停止。' : error.message, true);
  } finally {
    operation = null;
    refreshControls();
    log = () => {};
  }
}

function analyze(auto) {
  run(async (controller) => {
    clearPlan();
    if (!settings) {
      ui['settings-panel'].open = true;
      throw new Error('请先填写并保存模型设置。');
    }
    const tab = await activeTab();
    if (tab?.id === undefined) throw new Error('没有可读取的标签页。');
    controller.tabId = tab.id;
    log = createLogger(tab.id);
    log('开始', auto ? '自动答题' : '分析并预览');
    if (!await chrome.permissions.contains({ origins: [settings.permission] })) {
      ui['settings-panel'].open = true;
      throw new Error(`浏览器未允许连接模型接口。${siteAccessHint}`);
    }
    if (auto) {
      const summary = await runQuiz({
        tab, settings, controller, log, status,
        ask: (snapshot) => askModel(settings, snapshot, controller, log),
        onPlan: (documentId, snapshot, result) => {
          const current = renderPlan(tab, documentId, snapshot, result);
          current.used = true;
          refreshControls();
        },
        onOutcome: (answer, outcome) => {
          const record = plan?.cards.get(answer.question)?.outcome;
          if (record) { record.textContent = outcomeNames[outcome.state] + (outcome.detail ? '：' + outcome.detail : ''); record.hidden = false; }
        },
      });
      status(summary);
      return;
    }
    status('正在读取页面 HTML 和可点击元素…');
    const { result: snapshot, documentId } = await scanPage(tab, settings);
    log('页面读取', `HTML ${snapshot.html.length} 字符；${snapshot.targets.length} 个元素；${Object.keys(snapshot.routes).length ? new Set(Object.values(snapshot.routes).map((route) => route.documentId)).size : 0} 个文档；${snapshot.images.length} 张图片。${snapshot.truncated ? 'HTML 已截取。' : ''}`);
    await ensureActive(tab, controller.signal);
    status(`正在将页面 HTML 发送给 ${settings.model}，由 AI 识别题目并规划点击…`);
    const timer = setTimeout(() => controller.abort(new Error('模型请求超时（120 秒），未执行点击。')), 120000);
    let result;
    try {
      result = await requestAnswers(settings, snapshot, controller.signal, log);
    } finally {
      clearTimeout(timer);
    }
    await ensureActive(tab, controller.signal);
    renderPlan(tab, documentId, snapshot, result);
  });
}

ui.preview.addEventListener('click', () => analyze(false));
ui.auto.addEventListener('click', () => analyze(true));
ui.launcher.addEventListener('click', (event) => {
  const mode = event.target.closest('button[data-mode]')?.dataset.mode;
  if (!mode) return;
  run(async (controller) => {
    const tab = await activeTab();
    if (!tab?.id) throw new Error('没有可读取的标签页。');
    await ensureActive(tab, controller.signal);
    if (mode === 'sidebar') {
      await removeOverlay(tab.id);
      status('使用侧边栏开始答题。');
      return;
    }
    await showOverlay(tab, mode);
    status(mode === 'dot' ? '右下角已显示圆点。点击开始，右键展开。' : '右下角已显示悬浮窗，可在网页中开始答题。');
  });
});
ui.apply.addEventListener('click', () => {
  if (!plan || plan.used) return;
  const current = plan;
  run(async (controller) => {
    controller.tabId = current.tabId;
    log = createLogger(current.tabId);
    log('开始', '应用勾选的建议');
    await applyPlan(current, controller);
  });
});
ui.stop.addEventListener('click', () => {
  operation?.abort(new Error('已停止，不再开始下一题。'));
  status('正在停止；若正在点选，当前题可能已发生变化。');
  refreshControls();
});

chrome.tabs.onActivated.addListener((active) => {
  if (active.windowId !== windowId) return;
  if ((operation?.tabId !== undefined && active.tabId !== operation.tabId) || (plan && active.tabId !== plan.tabId)) invalidateTab();
  showTab().catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.windowId !== windowId) return;
  if (change.url || change.status === 'loading') invalidateTab(tabId);
  if (tab.active) showTab().catch(() => {});
});

try {
  ({ id: windowId } = await chrome.windows.getCurrent());
  const modelSettings = await loadSettings();
  ui.endpoint.value = modelSettings.endpoint;
  ui.model.value = modelSettings.model;
  ui.key.value = modelSettings.key;
  ui.api.value = modelSettings.api;
  ui.effort.value = modelSettings.effort;
  ui.vision.checked = modelSettings.vision;
  ui.summary.checked = modelSettings.summary;
  if (modelSettings.endpoint && modelSettings.model) settings = parseSettings(formValues());
  updateModelBadge();
  ui['settings-panel'].open = !settings;
  await showTab();
  ready = true;
  status(settings ? '准备就绪。建议先分析并预览。' : '首次使用请配置模型。');
} catch (error) {
  status(`无法初始化插件：${error.message}`, true);
} finally {
  refreshControls();
}
