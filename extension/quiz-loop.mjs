import { t } from './i18n.mjs';
import { applyAnswer, ensureActive, scanPage } from './runner.mjs';
import { requestAnswers } from './model.mjs';

const pause = (signal, duration = 350) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, duration);
  signal.addEventListener('abort', abort, { once: true });
});

export function questionText(html) {
  return String(html).replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ({
      '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    })[entity]).replace(/\s+/g, '');
}

export function confirmedQuestionChange(result, before, after) {
  const evidence = questionText(result.evidence || '');
  return result.pageChanged === true && evidence.length >= 4 &&
    questionText(after.html).includes(evidence) && !questionText(before.html).includes(evidence);
}

export async function askModel(settings, snapshot, controller, log) {
  const timer = setTimeout(() => controller.abort(new Error(t('timeout'))), 120000);
  try { return await requestAnswers(settings, snapshot, controller.signal, log); }
  finally { clearTimeout(timer); }
}

export async function runQuiz({ tab, settings, controller, log, status, ask, onPlan = () => {}, onOutcome = () => {}, onPage = async () => {} }) {
  const { signal } = controller;
  const visited = [];
  let current;
  let pages = 0;
  let total = 0;
  const read = async () => {
    await ensureActive(tab, signal);
    const entry = await scanPage(await chrome.tabs.get(tab.id), settings);
    log(t('logRead'), t('basicReadStats', entry.result.html.length, entry.result.targets.length));
    return entry;
  };
  const acceptChange = (check, before, after) => {
    if (!confirmedQuestionChange(check, before, after)) {
      if (check.pageChanged) log(t('logChangeCheck'), t('noChangeEvidence'));
      return false;
    }
    const evidence = questionText(check.evidence);
    if (visited.some((text) => text.includes(evidence))) throw new Error(t('repeatedQuestion'));
    log(t('logChangeConfirmed'), t('questionEvidence', check.evidence));
    return true;
  };
  for (let round = 0; round < 100; round += 1) {
    current ||= await read();
    const { result: snapshot, documentId } = current;
    await onPage();
    visited.push(questionText(snapshot.html));
    status(t('analyzingPage', pages + 1));
    const result = await ask({ ...snapshot, phase: 'solve' });
    await ensureActive(tab, signal);
    onPlan(documentId, snapshot, result);
    if (!result.answers.length) return result.message || t('noActionsSummary', pages, total);
    let incomplete = false;
    for (const answer of result.answers) {
      await ensureActive(tab, signal);
      const outcome = await applyAnswer(tab.id, documentId, snapshot, answer, log, signal);
      onOutcome(answer, outcome);
      if (['partial', 'skipped'].includes(outcome.state)) incomplete = true;
      else total += 1;
    }
    pages += 1;
    await pause(signal, 500);
    const after = await read();
    if (result.rejected) return t('invalidActions');
    status(t('checkingNext'));
    const context = { completed: result.questions.map((question) => question.prompt), previousHtml: snapshot.html };
    const navigation = await ask({ ...after.result, ...context, phase: 'navigate' });
    await ensureActive(tab, signal);
    if (acceptChange(navigation, snapshot, after.result)) {
      current = after;
      continue;
    }
    if (incomplete) return t('incompleteSummary', pages, total);
    if (!navigation.next) return t('finishedSummary', navigation.message || t('noNext'), pages, total);
    log(t('logNavigate'), `${navigation.next.target}：${navigation.next.reason || t('foundNext')}`);
    controller.navigating = true;
    try {
      const outcome = await applyAnswer(tab.id, after.documentId, after.result, {
        actions: [{ target: navigation.next.target, type: 'next', selected: null }],
      }, log, signal);
      if (!['clicked', 'applied'].includes(outcome.state)) return t('nextNotClickable');
      let changed;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await pause(signal, attempt ? 1500 : 700);
        const deadline = Date.now() + 15000;
        while ((await chrome.tabs.get(tab.id)).status === 'loading' && Date.now() < deadline) {
          await ensureActive(tab, signal);
          await pause(signal);
        }
        await ensureActive(tab, signal);
        const next = await read();
        status(t('verifyNext', attempt + 1));
        const check = await ask({ ...next.result, ...context, phase: 'verify' });
        await ensureActive(tab, signal);
        if (acceptChange(check, snapshot, next.result)) { changed = next; break; }
        log(t('logChangeCheck'), check.message || t('stillSameQuestion'));
      }
      if (!changed) return t('noNewQuestionSummary', pages, total);
      current = changed;
    } finally { controller.navigating = false; }
  }
  return t('pageLimitSummary', total);
}
