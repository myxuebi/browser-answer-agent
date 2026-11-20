(() => {
  if (globalThis.__answerAgentOverlay) return;
  const host = document.createElement('div');
  host.setAttribute('data-answer-agent-overlay', '');
  host.style.cssText = 'all:initial!important;position:fixed!important;right:14px!important;bottom:14px!important;z-index:2147483647!important;display:block!important;';
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
      :host { color-scheme: light; }
      [hidden] { display:none!important }
      section { width:min(236px,calc(100vw - 40px)); box-sizing:border-box; border:1px solid #c9e3d8; border-radius:15px; padding:11px; background:#f9fefb; color:#183229; box-shadow:0 8px 26px #153e3336; font:13px/1.45 system-ui,sans-serif; }
      header { display:flex; align-items:center; gap:7px; margin-bottom:7px }
      strong { flex:1; }
      svg { display:block }
      small { display:block; margin-top:7px; overflow-wrap:anywhere; min-height:1em; }
      details { margin-top:9px; border-top:1px solid #c9e3d8; padding-top:7px; }
      summary { cursor:pointer; font-size:12px; }
      #logs { max-height:210px; overflow:auto; font-size:11px; white-space:pre-wrap; overflow-wrap:anywhere; }
      #logs div { border-top:1px solid #e0ece5; padding:5px 0; }
      #logs:empty::after { content:'开始答题后显示运行记录'; color:#607367; }
      button { font:inherit; cursor:pointer; border:1px solid #c9e3d8; border-radius:7px; padding:4px 8px; background:#fff; color:#13382d; }
      button:focus-visible { outline:2px solid #137954; outline-offset:2px }
      button:disabled { opacity:.55; cursor:wait; }
      button.primary { background:#106548;color:white;border-color:#106548; }
      header button { padding:0 5px; font-size:15px; }
      #dot { display:block; margin-left:auto; width:19px; height:19px; padding:0; border:1px solid #bbf5df; border-radius:50%; background:#0d6b49; opacity:.42; box-shadow:0 1px 4px #13382d50; }
      #dot:hover,#dot:focus-visible { opacity:.9 }
      #dot[data-state="busy"] { background:#b76513; }
      #dot[data-state="error"] { background:#ae4035; }
      #bubble { margin:0 0 6px; max-width:min(236px,calc(100vw - 40px)); border-radius:7px; padding:5px 8px; background:#163e30; color:white; font:12px/1.4 system-ui,sans-serif; overflow-wrap:anywhere; }
  `);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = `
    <section hidden aria-label="答题 Agent">
      <header><svg aria-hidden="true" width="21" height="21" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="16" fill="#12694D"/><path d="M20 12h17l9 9v31H17V12h3Z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="m23 34 6 6 12-13" fill="none" stroke="#9FF0C4" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg><strong>答题 Agent</strong><button id="min" title="缩小为圆点" aria-label="缩小为圆点" type="button">−</button><button id="close" title="移除悬浮入口" aria-label="移除悬浮入口" type="button">×</button></header>
      <button class="primary" id="start" type="button">开始答题</button>
      <button id="stop" type="button" hidden>停止</button>
      <small id="status" role="status">自动点选、填入答案，并继续下一题。</small>
      <details open><summary>运行日志（圆点右键展开可查看）</summary><div id="logs" role="log" aria-label="运行日志" aria-live="polite"></div></details>
    </section>
    <p id="bubble" role="status" hidden></p>
    <button id="dot" type="button" title="开始答题（右键展开）" aria-label="开始答题（右键展开）" hidden></button>`;
  const find = (id) => root.getElementById(id);
  const panel = root.querySelector('section');
  const dot = find('dot');
  const bubble = find('bubble');
  let busy = false;
  let mode = 'sidebar';
  let timer;

  function appendLog(entry) {
    const list = find('logs');
    const follow = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const row = document.createElement('div');
    row.textContent = `${new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false })} · ${entry.kind}\n${entry.text}`;
    list.append(row);
    while (list.children.length > 300) list.firstElementChild.remove();
    if (follow) list.scrollTop = list.scrollHeight;
  }

  function show(display) {
    mode = display;
    panel.hidden = mode !== 'floating';
    dot.hidden = mode !== 'dot';
    bubble.hidden = true;
    if (mode === 'sidebar') {
      stop();
      host.remove();
    }
    else if (!host.isConnected) document.documentElement.append(host);
  }

  function report(message, state) {
    find('status').textContent = message;
    dot.title = `${message}｜${busy ? '点击停止' : '点击开始'}，右键展开`;
    dot.setAttribute('aria-label', dot.title);
    dot.dataset.state = state;
    clearTimeout(timer);
    if (mode === 'dot' && state !== 'busy') {
      bubble.textContent = message;
      bubble.hidden = false;
      timer = setTimeout(() => { bubble.hidden = true; }, 4500);
    }
  }

  async function start() {
    if (busy) return;
    busy = true;
    find('start').disabled = true;
    find('stop').hidden = false;
    report('正在读取当前网页…', 'busy');
    let message;
    let state = 'done';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'overlay-start', mode });
      if (result?.error || !result?.status) throw new Error(result?.error || '任务已结束，请重新打开插件后再试。');
      message = result.status;
    } catch (error) {
      message = error.message;
      state = 'error';
    } finally {
      busy = false;
      find('start').disabled = false;
      find('stop').hidden = true;
      report(message, state);
    }
  }

  function stop() {
    if (busy) chrome.runtime.sendMessage({ type: 'overlay-stop' }).catch(() => {});
  }

  function onClick(id, action) {
    find(id).addEventListener('click', (event) => {
      if (event.isTrusted) action();
    });
  }

  onClick('start', start);
  onClick('stop', stop);
  onClick('min', () => show('dot'));
  onClick('close', () => show('sidebar'));
  onClick('dot', () => busy ? stop() : start());
  dot.addEventListener('contextmenu', (event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    show('floating');
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'overlay-state') {
      busy = message.busy;
      find('start').disabled = busy;
      find('stop').hidden = !busy;
      report(message.status, busy ? 'busy' : message.error ? 'error' : 'done');
    }
    if (sender.id === chrome.runtime.id && message?.type === 'overlay-log' && message.entry) appendLog(message.entry);
    if (sender.id === chrome.runtime.id && message?.type === 'overlay-progress' && busy) report(message.status, 'busy');
  });
  globalThis.__answerAgentOverlay = { show };
})();
