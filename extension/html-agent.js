(() => {
  if (globalThis.__htmlAnswerAgent) return;
  let snapshot;
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const ignored = 'script,style,noscript,template,meta,link,head,[data-answer-agent-overlay]';
  const interactive = 'input,textarea,[contenteditable],a,[role="link"],label,button,[role="radio"],[role="checkbox"],[role="option"],[onclick],[tabindex]';
  const editable = (element) => element.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="number"],input[type="email"],input[type="url"],input[type="tel"],[contenteditable="true"],[contenteditable=""]');
  const forward = (element) => /下一|下页|后一题|继续|next|continue|^[→›»>❯]$/i.test(clean(element.innerText || element.value || element.getAttribute('aria-label') || element.title)) &&
    !/提交|交卷|submit|finish/i.test(clean(element.innerText || element.value || element.getAttribute('aria-label')));

  function shown(element) {
    for (let current = element; current; current = current.parentElement || current.getRootNode().host) {
      const style = getComputedStyle(current);
      if (current.matches('[hidden],[inert],[aria-hidden="true"]') || style.display === 'none' ||
          ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return true;
  }

  function blocked(element, navigation = false) {
    if (element.closest(':disabled,[aria-disabled="true"],[inert]')) return true;
    if (!navigation && element.closest('a,area,[role="link"]')) return true;
    if (element.matches('input:not([type="radio"]):not([type="checkbox"])') && !editable(element) &&
        !(navigation && forward(element))) return true;
    if (editable(element) && element.readOnly) return true;
    const button = element.closest('button,input[type="submit"],input[type="reset"]');
    return Boolean(button && (button.type === 'submit' || button.type === 'reset') && !(navigation && forward(button))) ||
      /^(?:提交(?:答案|试卷|练习)?|交卷|确认提交|submit|finish quiz)$/i.test(clean(element.innerText || element.getAttribute('aria-label')));
  }

  function state(element) {
    const control = element.matches('label') ? element.control : element;
    if (control?.matches('input[type="radio"],input[type="checkbox"]')) return control.checked;
    const value = control?.getAttribute('aria-checked') ?? control?.getAttribute('aria-selected') ?? control?.getAttribute('aria-pressed');
    return value === 'true' ? true : value === 'false' ? false : null;
  }

  function signature(element) {
    return JSON.stringify([element.tagName, element.id, element.getAttribute('role'), element.getAttribute('name'),
      editable(element) ? '' : clean(element.textContent).slice(0, 1600), element.getAttribute('aria-label'),
      element.matches('input[type="button"],input[type="submit"]') ? element.value : '',
      Array.from(element.querySelectorAll('img')).map((image) => image.currentSrc || image.src)]);
  }

  function imageData(image) {
    if (!image.complete || !image.naturalWidth) return '';
    const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    try {
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.82);
      return data.length <= 490000 ? data : '';
    } catch {
      return '';
    }
  }

  function scan({ vision }) {
    snapshot = { token: crypto.randomUUID(), url: location.href, targets: new Map() };
    let remaining = 160000;
    let visited = 0;
    let truncated = false;
    let skippedImages = 0;
    const targets = [];
    const images = [];
    function serialize(node, depth = 0) {
      if (remaining <= 0 || visited++ > 12000 || depth > 60) {
        truncated = true;
        return '';
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const text = escape(node.textContent).slice(0, Math.min(remaining, 6000));
        remaining -= text.length;
        return text;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches(ignored) || !shown(node)) return '';
      const tag = node.tagName.toLowerCase();
      const attributes = [];
      for (const name of ['id', 'class', 'role', 'type', 'name', 'for', 'alt', 'title', 'placeholder', 'maxlength', 'aria-label', 'aria-checked', 'aria-selected', 'aria-pressed', 'disabled']) {
        if (node.hasAttribute(name)) attributes.push(`${name}="${escape(node.getAttribute(name).slice(0, 300))}"`);
      }
      if (node.matches('input') && node.checked) attributes.push('checked');
      const navigation = node.matches('a,[role="link"]') || (forward(node) &&
        (node.matches('button,[role="button"],input[type="button"],input[type="submit"]') ||
        (node.matches('div,span') && clean(node.textContent).length < 40 && !node.querySelector('button,a,input,textarea'))));
      const actionable = !blocked(node, navigation) && node.getClientRects().length > 0 &&
        (node.matches(interactive) || node.matches('div,span,li,td,p,img,svg') || getComputedStyle(node).cursor === 'pointer');
      let id;
      if (actionable && targets.length < 1800) {
        id = `e${targets.length + 1}`;
        attributes.push(`data-agent-id="${id}"`);
        const text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('alt') ||
          (node.matches('input[type="button"],input[type="submit"]') ? node.value : '')).slice(0, 350);
        const kind = editable(node) ? 'input' : navigation ? 'navigation' : 'click';
        const canNavigate = kind !== 'input' && (navigation || node.matches('button,[role="button"],input[type="button"]') ||
          (node.matches('div,span') && clean(node.textContent).length < 80 && !node.querySelector('button,a,input,textarea')));
        const value = editable(node) ? node.isContentEditable ? node.textContent : node.value : undefined;
        targets.push({ id, tag, text, kind, canNavigate, value, selected: state(node) });
        snapshot.targets.set(id, { element: node, signature: signature(node), selected: state(node), value, kind, canNavigate });
      } else if (actionable) truncated = true;
      if (tag === 'img') {
        if (vision && images.length < 6) {
          const data = imageData(node);
          if (data) images.push({ element: id || node.id || 'image', data });
          else skippedImages += 1;
        } else skippedImages += 1;
      }
      const open = `<${tag}${attributes.length ? ' ' + attributes.join(' ') : ''}>`;
      remaining -= open.length + tag.length + 3;
      const children = node.matches('input,textarea,select') || editable(node) ? '' :
        Array.from(node.childNodes).map((child) => serialize(child, depth + 1)).join('');
      const shadow = node.shadowRoot ? '<shadow-root>' + Array.from(node.shadowRoot.childNodes)
        .map((child) => serialize(child, depth + 1)).join('') + '</shadow-root>' : '';
      return open + children + shadow + `</${tag}>`;
    }
    const html = serialize(document.body || document.documentElement);
    return { token: snapshot.token, html, targets, images, skippedImages, truncated, title: document.title, url: location.href };
  }

  async function apply({ token, actions }) {
    if (snapshot?.token !== token || snapshot.url !== location.href || document.visibilityState !== 'visible') {
      return { state: 'skipped', detail: '页面已变化，请重新分析。' };
    }
    let clicks = 0;
    let uncertain = false;
    const stale = () => ({ state: clicks ? 'partial' : 'skipped', detail: '目标元素已变化或不可点击，请重新分析。' });
    for (const action of actions) {
      const original = snapshot.targets.get(action.target);
      const element = original?.element;
      if (!element?.isConnected || blocked(element, action.type === 'next') || !shown(element) || !element.getClientRects().length ||
          signature(element) !== original.signature) return stale();
      const before = state(element);
      if (action.type === 'fill') {
        if (!editable(element) || typeof action.value !== 'string') return stale();
        const current = element.isContentEditable ? element.textContent : element.value;
        if (current === action.value) continue;
        if (current !== original.value) return stale();
        element.focus();
        if (element.isContentEditable) element.textContent = action.value;
        else {
          const prototype = element.matches('textarea') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, action.value);
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: action.value }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        clicks += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (!element.isConnected || (element.isContentEditable ? element.textContent : element.value) !== action.value) {
          return { state: 'partial', detail: '输入后控件变化或内容未保留。' };
        }
        continue;
      }
      if (action.type === 'next') {
        if (!original.canNavigate) return stale();
        element.click();
        return { state: 'clicked', detail: '已点击下一题／下一页，等待内容更新。' };
      }
      if (typeof action.selected === 'boolean' && before === action.selected) continue;
      if (before !== original.selected) return stale();
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      element.click();
      clicks += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (snapshot?.token !== token || snapshot.url !== location.href || !element.isConnected ||
          signature(element) !== original.signature) return stale();
      const after = state(element);
      if (typeof action.selected === 'boolean' && after !== null && after !== action.selected) {
        return { state: 'partial', detail: '点击后选中状态不匹配。' };
      }
      if (after === null) uncertain = true;
    }
    return { state: uncertain ? 'clicked' : clicks ? 'applied' : 'unchanged',
      ...(uncertain ? { detail: '已模拟点击；页面没有提供可核对的选中状态。' } : {}) };
  }

  globalThis.__htmlAnswerAgent = { scan, apply };
})();
