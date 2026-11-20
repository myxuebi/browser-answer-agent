import './i18n.js';

const nativeMessages = Boolean(globalThis.chrome?.i18n?.getMessage);
const locale = new URLSearchParams(globalThis.location?.search).get('locale') ||
  globalThis.navigator?.language || 'zh-CN';
let catalog;
let loading;

export async function initializeLocale() {
  if (nativeMessages || catalog) return;
  loading ||= fetch(new URL(
    '_locales/' + (locale.toLowerCase().startsWith('en') ? 'en' : 'zh_CN') + '/messages.json', import.meta.url,
  )).then((response) => response.json());
  catalog = await loading;
}

export function t(key, ...values) {
  if (nativeMessages) return chrome.i18n.getMessage(key, values.map(String)) || key;
  return (catalog?.[key]?.message || key).replace(/\$arg(\d+)\$/g, (_, number) => String(values[Number(number) - 1] ?? ''));
}

export function localize(root) {
  return globalThis.__answerAgentI18n.localize(root, t);
}
