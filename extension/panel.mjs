import { t, localize } from './i18n.mjs';
localize(document);
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
const outcomeNames = { applied: t('applied'), unchanged: t('unchanged'), clicked: t('clicked'), partial: t('partial'), skipped: t('skipped') };

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
  ui['log-count'].textContent = t('logCount', entries.length);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && logTabId !== undefined && changes[logKey(logTabId)]) {
    showLogs(changes[logKey(logTabId)].newValue ?? []);
  }
});

ui['log-clear'].addEventListener('click', async () => {
  if (logTabId === undefined) return;
  try { await chrome.runtime.sendMessage({ type: 'log-clear', tabId: logTabId }); }
  catch { status(t('clearLogFailed'), true); }
});
ui['log-copy'].addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logEntries.map((entry) => `[${logTime(entry.time)}] [${entry.kind}] ${entry.text}`).join('\n'));
    status(t('logsCopied'));
  } catch { status(t('copyDenied'), true); }
});

function status(message, error = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', error);
  log(error ? t('logError') : t('logRuntime'), message);
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
  const label = isRestrictedPage(tab?.url) ? t('restrictedTab')
    : tab?.title || t('missingTitle', siteAccessHint);
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
  const message = t('pageChanged');
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
  ui['model-badge'].textContent = settings?.model || t('notConfigured');
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
      throw new Error(t('endpointChanged'));
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
    status(t('settingsSaved'));
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
    if (!answer) outcome.textContent = t('answerSkipped');
    card.append(outcome);
    plan.cards.set(question.id, { checkbox, outcome });
    return card;
  });
  ui.questions.replaceChildren(...cards);
  ui.coverage.textContent = t('coverage', answers.length);
  ui.results.hidden = false;
  const notes = [snapshot.truncated && t('htmlTruncated'), rejected > 0 && t('ignoredReplies', rejected), plan.imageNote].filter(Boolean);
  const summary = answers.length ? t('suggestionsReady', answers.length) : result.message || t('noAnswer');
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
      status(t('applyingQuestion', completed + 1, selected.length));
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
    throw new Error(t('partialSummary', error.message, counts.verified, counts.clicked));
  }
  status(t('applySummary', counts.verified, counts.clicked, counts.skipped, current.imageNote || ''));
}

async function run(work) {
  if (!ready || operation || saving) return;
  const controller = new AbortController();
  operation = controller;
  refreshControls();
  try {
    await work(controller);
  } catch (error) {
    status(error.name === 'AbortError' ? controller.signal.reason?.message || t('stopped') : error.message, true);
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
      throw new Error(t('configureFirst'));
    }
    const tab = await activeTab();
    if (tab?.id === undefined) throw new Error(t('noTab'));
    controller.tabId = tab.id;
    log = createLogger(tab.id);
    log(t('logStart'), auto ? t('auto') : t('preview'));
    if (!await chrome.permissions.contains({ origins: [settings.permission] })) {
      ui['settings-panel'].open = true;
      throw new Error(t('apiPermissionDenied', siteAccessHint));
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
    status(t('readingHtml'));
    const { result: snapshot, documentId } = await scanPage(tab, settings);
    log(t('logRead'), t('snapshotStats', snapshot.html.length, snapshot.targets.length, new Set(Object.values(snapshot.routes).map((route) => route.documentId)).size, snapshot.images.length, snapshot.truncated ? t('htmlTruncated') : ''));
    await ensureActive(tab, controller.signal);
    status(t('sendingHtml', settings.model));
    const timer = setTimeout(() => controller.abort(new Error(t('timeoutNoClick'))), 120000);
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
    if (!tab?.id) throw new Error(t('noTab'));
    await ensureActive(tab, controller.signal);
    if (mode === 'sidebar') {
      await removeOverlay(tab.id);
      status(t('useSidebar'));
      return;
    }
    await showOverlay(tab, mode);
    status(mode === 'dot' ? t('dotShown') : t('floatingShown'));
  });
});
ui.apply.addEventListener('click', () => {
  if (!plan || plan.used) return;
  const current = plan;
  run(async (controller) => {
    controller.tabId = current.tabId;
    log = createLogger(current.tabId);
    log(t('logStart'), t('apply'));
    await applyPlan(current, controller);
  });
});
ui.stop.addEventListener('click', () => {
  operation?.abort(new Error(t('stopNext')));
  status(t('stopping'));
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
  status(settings ? t('ready') : t('firstUse'));
} catch (error) {
  status(t('initFailed', error.message), true);
} finally {
  refreshControls();
}
