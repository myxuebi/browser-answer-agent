import { requestAnswers } from './model.mjs';

const running = new Map();
self.onmessage = async ({ data: { id, settings, snapshot, cancel } }) => {
  if (cancel) {
    running.get(id)?.abort(new Error('已停止。'));
    return;
  }
  const controller = new AbortController();
  running.set(id, controller);
  const timeout = setTimeout(() => controller.abort(new Error('模型请求超时（120 秒）。')), 120000);
  try {
    const result = await requestAnswers(settings, snapshot, controller.signal,
      (kind, text) => self.postMessage({ id, entry: { kind, text } }));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  } finally {
    clearTimeout(timeout);
    running.delete(id);
  }
};
