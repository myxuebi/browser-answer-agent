(() => {
  if (globalThis.__answerAgentI18n) return;
  const t = (key, ...values) => chrome.i18n.getMessage(key, values.map(String)) || key;
  function localize(root, translate = t) {
    if (root.nodeType === 9) root.documentElement.lang = translate('locale');
    for (const element of root.querySelectorAll('[data-i18n]')) {
      element.textContent = translate(element.dataset.i18n);
    }
    for (const attribute of ['title', 'aria-label', 'placeholder', 'empty-label']) {
      for (const element of root.querySelectorAll('[data-i18n-' + attribute + ']')) {
        element.setAttribute(attribute === 'empty-label' ? 'data-empty-label' : attribute,
          translate(element.getAttribute('data-i18n-' + attribute)));
      }
    }
  }
  globalThis.__answerAgentI18n = { t, localize };
})();
