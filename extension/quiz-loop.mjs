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
  const timer = setTimeout(() => controller.abort(new Error('模型请求超时（120 秒）。')), 120000);
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
    log('页面读取', `HTML ${entry.result.html.length} 字符，${entry.result.targets.length} 个元素。`);
    return entry;
  };
  const acceptChange = (check, before, after) => {
    if (!confirmedQuestionChange(check, before, after)) {
      if (check.pageChanged) log('换题核对', 'AI 未提供可核对的新题原文，不将页面文字变化视为换题。');
      return false;
    }
    const evidence = questionText(check.evidence);
    if (visited.some((text) => text.includes(evidence))) throw new Error('检测到返回已经处理过的题目，已停止重复作答。');
    log('换题确认', `已核对新题原文：${check.evidence}`);
    return true;
  };
  for (let round = 0; round < 100; round += 1) {
    current ||= await read();
    const { result: snapshot, documentId } = current;
    await onPage();
    visited.push(questionText(snapshot.html));
    status(`正在分析第 ${pages + 1} 页…`);
    const result = await ask({ ...snapshot, phase: 'solve' });
    await ensureActive(tab, signal);
    onPlan(documentId, snapshot, result);
    if (!result.answers.length) return result.message || `当前页没有可执行答案，已处理 ${pages} 页、${total} 题。`;
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
    if (result.rejected) return '模型回复包含无效操作，已停止自动翻页，请检查日志后重新分析。';
    status('当前页作答完成，正在让 AI 判断是否有下一题／下一页…');
    const context = { completed: result.questions.map((question) => question.prompt), previousHtml: snapshot.html };
    const navigation = await ask({ ...after.result, ...context, phase: 'navigate' });
    await ensureActive(tab, signal);
    if (acceptChange(navigation, snapshot, after.result)) {
      current = after;
      continue;
    }
    if (incomplete) return `本页存在未完成或待核对的操作，已停止翻页。已处理 ${pages} 页、${total} 题。`;
    if (!navigation.next) return `${navigation.message || 'AI 判断没有下一题，答题结束。'} 已处理 ${pages} 页、${total} 题。`;
    log('自动翻题', `${navigation.next.target}：${navigation.next.reason || 'AI 识别到下一题／下一页。'}`);
    controller.navigating = true;
    try {
      const outcome = await applyAnswer(tab.id, after.documentId, after.result, {
        actions: [{ target: navigation.next.target, type: 'next', selected: null }],
      }, log, signal);
      if (!['clicked', 'applied'].includes(outcome.state)) return '下一题控件无法点击，请检查运行日志。';
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
        status(`已点击下一题，正在让 AI 核对题目是否更新（${attempt + 1}/3）…`);
        const check = await ask({ ...next.result, ...context, phase: 'verify' });
        await ensureActive(tab, signal);
        if (acceptChange(check, snapshot, next.result)) { changed = next; break; }
        log('换题核对', check.message || '仍是刚才的题目或尚未加载新题，等待后再核对；不重新作答。');
      }
      if (!changed) return `已点击下一题，但多次核对仍未确认新题，已停止；不会重复分析同一道题或重复点击。已处理 ${pages} 页、${total} 题。`;
      current = changed;
    } finally { controller.navigating = false; }
  }
  return `已达到单次 100 页上限。共处理 ${total} 题。`;
}
