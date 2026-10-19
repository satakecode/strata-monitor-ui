(() => {
  const DEFAULTS = { base: 'http://127.0.0.1:8080', keyMode: 'x-api-key', auto: true };
  const safeStore = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} }
  };
  const state = {
    base: safeStore.get('strata-monitor.base', DEFAULTS.base),
    keyMode: safeStore.get('strata-monitor.keyMode', DEFAULTS.keyMode), apiKey: '', auto: safeStore.get('strata-monitor.auto', 'true') === 'true',
    requests: [], selectedId: null, detail: null, detailRaw: null, filter: 'all', query: '', busy: false
  };
  const $ = (selector) => document.querySelector(selector);
  const shell = $('.app-shell');
  let refreshTimer = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function pretty(value) {
    if (value === undefined) return 'Not recorded';
    if (value === null) return 'null';
    if (typeof value === 'string') {
      try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
    }
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  function asObject(value) {
    if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
    return value && typeof value === 'object' ? value : null;
  }
  function textValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return pretty(value);
  }
  function formatDate(value) {
    if (value === null || value === undefined || value === '') return 'Time unavailable';
    const date = new Date(Number(value) * 1000);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
  }
  function duration(value, digits = 2) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(digits)}s` : '—';
  }
  function number(value) { return Number.isFinite(Number(value)) ? new Intl.NumberFormat().format(Number(value)) : '—'; }
  function errorLike(request) {
    const stateText = String(request?.state || '').toLowerCase();
    const code = Number(request?.http_status || 0);
    return stateText === 'disconnected' || stateText === 'failed' || stateText === 'error' || (code >= 400) || !!request?.outcome;
  }
  function errorMessage(payload, fallback) {
    if (payload && typeof payload === 'object') {
      if (typeof payload.error === 'string') return payload.error;
      if (payload.error?.message) return payload.error.message;
      if (payload.detail) return typeof payload.detail === 'string' ? payload.detail : pretty(payload.detail);
    }
    return fallback;
  }
  async function fetchJson(path, includeRaw = false) {
    let url;
    const headers = {};
    url = `/bridge${path}?base=${encodeURIComponent(state.base)}`;
    if (path.includes('?')) {
      const [route, params] = path.split('?');
      url = `/bridge${route}?base=${encodeURIComponent(state.base)}&${params}`;
    }
    if (state.apiKey) { headers['X-Strata-Api-Key'] = state.apiKey; headers['X-Strata-Key-Mode'] = state.keyMode === 'bearer' ? 'bearer' : 'x-api-key'; }
    const response = await fetch(url, { headers, cache: 'no-store' });
    let payload;
    const raw = await response.text();
    try { payload = JSON.parse(raw); } catch { payload = { error: raw || response.statusText }; }
    if (!response.ok) throw new Error(errorMessage(payload, `Request failed with HTTP ${response.status}`));
    return includeRaw ? { payload, raw } : payload;
  }
  function listItems(payload) {
    if (Array.isArray(payload)) return payload;
    return Array.isArray(payload?.requests) ? payload.requests : Array.isArray(payload?.data) ? payload.data : [];
  }
  async function loadRequests(keepSelection = true) {
    if (state.busy) return;
    state.busy = true;
    $('#connection-dot').className = 'live-dot';
    try {
      const payload = await fetchJson('/requests');
      state.requests = listItems(payload).slice().sort((a, b) => Number(b.started_at || 0) - Number(a.started_at || 0));
      $('#connection-dot').className = 'live-dot connected';
      $('#source-label').textContent = 'Connected to Strata';
      $('#list-footnote').textContent = `${state.requests.length} retained`;
      renderList();
      if (keepSelection && state.selectedId) {
        if (state.requests.some((item) => item.id === state.selectedId)) await loadDetail(state.selectedId, false, true);
        else clearDetail();
      } else if (state.selectedId && !state.requests.some((item) => item.id === state.selectedId)) clearDetail();
    } catch (error) {
      $('#connection-dot').className = 'live-dot error';
      $('#source-label').textContent = 'Connection failed';
      $('#list-footnote').textContent = 'Unable to load';
      if (!state.requests.length) {
        const list = $('#request-list'); list.replaceChildren();
        const message = el('div', 'error-banner', error.message); list.append(message);
        const hint = el('div', 'empty-list', 'Check the base URL and API key in settings.'); list.append(hint);
      } else toast(error.message);
    } finally { state.busy = false; }
  }
  function matchesFilter(request) {
    if (state.filter === 'completed' && String(request.state).toLowerCase() !== 'completed') return false;
    if (state.filter === 'issues' && !errorLike(request)) return false;
    if (!state.query) return true;
    return [request.id, request.model, request.path, request.state, request.http_status].some((x) => String(x || '').toLowerCase().includes(state.query));
  }
  function renderList() {
    const complete = state.requests.filter((r) => String(r.state).toLowerCase() === 'completed').length;
    const issues = state.requests.filter(errorLike).length;
    $('#count-all').textContent = String(state.requests.length); $('#count-completed').textContent = String(complete); $('#count-issues').textContent = String(issues);
    const items = state.requests.filter(matchesFilter); const list = $('#request-list'); const previousScroll = list.scrollTop; list.replaceChildren();
    if (!items.length) { list.append(el('div', 'empty-list', state.requests.length ? 'No requests match this search.' : 'No requests were recorded yet.')); list.scrollTop = previousScroll; return; }
    for (const request of items) {
      const button = el('button', `request-card${request.id === state.selectedId ? ' selected' : ''}`); button.type = 'button'; button.addEventListener('click', () => loadDetail(request.id));
      const top = el('div', 'card-top'); top.append(el('span', 'card-model', request.model || request.path || 'Unknown model'), el('span', `status-pill${errorLike(request) ? ' issue' : ''}${String(request.state).toLowerCase() === 'queued' ? ' pending' : ''}`, request.state || 'unknown'));
      const mid = el('div', 'card-mid'); mid.append(el('span', 'card-id', request.id || 'ID unavailable'), el('span', 'card-date', formatDate(request.started_at)));
      const bottom = el('div', 'card-bottom'); bottom.append(el('span', 'card-endpoint', `${request.path || '/api request'}${request.http_status ? ` · ${request.http_status}` : ''}`), el('span', 'card-tokens', request.usage?.total_tokens ? `${number(request.usage.total_tokens)} tok` : duration(request.wallclock_s)));
      button.append(top, mid, bottom); list.append(button);
    }
    list.scrollTop = previousScroll;
  }
  async function loadDetail(id, select = true, preserveView = false) {
    const mainPanel = $('#main-panel');
    try {
      const { payload, raw } = await fetchJson(`/requests?id=${encodeURIComponent(id)}`, true);
      const nextDetail = payload?.request || payload?.data || payload;
      const unchanged = state.detail && JSON.stringify(state.detail) === JSON.stringify(nextDetail);
      const previousScroll = mainPanel.scrollTop;
      state.selectedId = id; state.detail = nextDetail; state.detailRaw = raw;
      $('#raw-api-response').textContent = raw;
      if (select) shell.classList.add('show-detail');
      renderList();
      if (!unchanged) {
        renderDetail();
        if (preserveView) {
          requestAnimationFrame(() => { mainPanel.scrollTop = previousScroll; });
        }
      }
    } catch (error) { toast(`Could not load request: ${error.message}`); }
  }
  function clearDetail() { state.selectedId = null; state.detail = null; state.detailRaw = null; $('#detail-view').classList.add('hidden'); $('#welcome').classList.remove('hidden'); }
  function addMeta(label, cls = '') { const chip = el('span', `meta-chip ${cls}`.trim(), label); $('#meta-strip').append(chip); }
  function metric(label, value, detail = '') {
    const box = el('div', 'metric'); box.append(el('div', 'metric-label', label), el('div', 'metric-value', value)); if (detail) box.append(el('div', 'metric-detail', detail)); return box;
  }
  function renderDetail() {
    const r = state.detail; if (!r) return;
    $('#welcome').classList.add('hidden'); $('#detail-view').classList.remove('hidden');
    $('#detail-id-short').textContent = r.id || 'Unknown ID';
    $('#detail-title').textContent = r.model || 'Request details';
    $('#detail-subtitle').textContent = `${r.path || 'Endpoint unavailable'}  ·  ${r.id || 'No request ID'}`;
    const meta = $('#meta-strip'); meta.replaceChildren();
    addMeta(String(r.state || 'unknown').toUpperCase(), errorLike(r) ? 'issue' : 'success');
    if (r.http_status !== undefined && r.http_status !== null) addMeta(`HTTP ${r.http_status}`, Number(r.http_status) >= 400 ? 'issue' : '');
    if (r.stream !== undefined) addMeta(r.stream ? 'STREAM' : 'NON-STREAM');
    if (r.response_format) addMeta(`FORMAT ${typeof r.response_format === 'string' ? r.response_format : r.response_format.type || 'CUSTOM'}`);
    if (r.input_truncated) addMeta('INPUT TRUNCATED', 'issue'); if (r.output_truncated) addMeta('OUTPUT TRUNCATED', 'issue'); if (r.reasoning_truncated) addMeta('REASONING TRUNCATED', 'issue');
    if (r.outcome) addMeta(`OUTCOME ${r.outcome}`, 'issue');
    const usage = r.usage || {}; const timings = r.timings || {};
    const metrics = $('#metric-grid'); metrics.replaceChildren(
      metric('WALL CLOCK', duration(r.wallclock_s), `Started ${formatDate(r.started_at)}`),
      metric('FIRST TOKEN', duration(r.first_token_s), `Queue ${duration(r.queue_s)} · load ${duration(r.load_s)}`),
      metric('PROMPT TOKENS', number(usage.prompt_tokens), `${number(timings.prompt_n)} uncached · ${number(timings.cache_n)} cached`),
      metric('OUTPUT TOKENS', number(usage.completion_tokens), `Total ${number(usage.total_tokens)}`),
      metric('DECODE SPEED', Number.isFinite(Number(timings.predicted_per_second)) ? `${Number(timings.predicted_per_second).toFixed(1)} tok/s` : '—', `Prompt ${Number.isFinite(Number(timings.prompt_per_second)) ? `${Number(timings.prompt_per_second).toFixed(1)} tok/s` : '—'}`)
    );
    renderRequestResponse(r);
  }
  function renderRequestResponse(request) {
    const input = asObject(request.input);
    const inputMetadata = input && !Array.isArray(input) ? { ...input } : null;
    const messages = inputMetadata && Array.isArray(inputMetadata.messages) ? inputMetadata.messages : [];
    if (inputMetadata) delete inputMetadata.messages;
    renderRequestMessages(messages);
    $('#request-json').textContent = inputMetadata ? pretty(inputMetadata) : textValue(request.input) || 'No request input was captured.';

    const requestKeys = ['id', 'path', 'model', 'started_at', 'stream', 'response_format', 'input_truncated'];
    const requestMetadata = Object.fromEntries(requestKeys.filter((key) => key in request).map((key) => [key, request[key]]));
    const envelope = $('#request-envelope'); envelope.replaceChildren();
    for (const [key, value] of Object.entries(requestMetadata)) {
      const field = el('div', 'envelope-field');
      field.append(el('span', 'envelope-key', key), el('span', 'envelope-value', typeof value === 'object' ? pretty(value) : String(value)));
      envelope.append(field);
    }

    renderResponseValue($('#response-output'), 'Output', request.output);
    renderResponseValue($('#response-reasoning'), 'Reasoning', request.reasoning);
    $('#raw-api-response').textContent = state.detailRaw ?? '';
    const excluded = new Set([...requestKeys, 'input', 'output', 'reasoning']);
    const responseMetadata = Object.fromEntries(Object.entries(request).filter(([key]) => !excluded.has(key)));
    const responseFields = $('#response-fields'); responseFields.replaceChildren();
    const card = el('div', 'payload-card response-metadata');
    card.append(el('div', 'payload-card-head', 'Response metadata JSON'), el('pre', 'payload-json', pretty(responseMetadata)));
    responseFields.append(card);
  }
  function renderRequestMessages(messages) {
    const list = $('#request-messages'); list.replaceChildren();
    if (!messages.length) {
      list.append(el('div', 'missing-value message-empty', 'No messages were captured in the request input.'));
      return;
    }
    messages.forEach((message, index) => {
      const item = message && typeof message === 'object' && !Array.isArray(message) ? message : { content: message };
      const role = String(item.role || 'unknown').toLowerCase();
      const roleClass = role.replace(/[^a-z0-9_-]/g, '') || 'unknown';
      const card = el('article', `message-card request-message-card role-${roleClass}`);
      const head = el('div', 'message-head');
      const label = el('span', 'role-label', role);
      const meta = el('span', 'message-meta', `MESSAGE ${index + 1}${item.name ? ` · ${item.name}` : ''}`);
      head.append(label, meta);
      const scroll = el('div', 'request-message-scroll');
      renderMessageContent(scroll, item.content);
      card.append(head, scroll);
      const fields = Object.fromEntries(Object.entries(item).filter(([key]) => !['role', 'content'].includes(key)));
      if (Object.keys(fields).length) {
        const extras = el('details', 'message-extra');
        extras.append(el('summary', '', 'Additional message fields'), el('pre', 'message-extra-json', pretty(fields)));
        scroll.append(extras);
      }
      list.append(card);
    });
  }
  function renderMessageContent(target, content) {
    if (content === undefined || content === null) {
      target.append(el('div', 'missing-value', 'No message content was captured.'));
    } else if (typeof content === 'string') {
      target.append(renderReadableText(content));
    } else if (Array.isArray(content)) {
      content.forEach((part, index) => {
        const wrapper = el('div', 'message-content-part');
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          if (part.type && part.type !== 'text') wrapper.append(el('div', 'part-label', part.type));
          wrapper.append(renderReadableText(part.text));
          const extra = Object.fromEntries(Object.entries(part).filter(([key]) => !['type', 'text'].includes(key)));
          if (Object.keys(extra).length) wrapper.append(el('pre', 'message-extra-json', pretty(extra)));
        } else {
          wrapper.append(el('div', 'part-label', `Content part ${index + 1}`), el('pre', 'message-extra-json', pretty(part)));
        }
        target.append(wrapper);
      });
    } else {
      target.append(el('pre', 'message-extra-json', pretty(content)));
    }
  }
  function renderResponseValue(target, title, value) {
    target.replaceChildren();
    const card = el('div', 'payload-card');
    card.append(el('div', 'payload-card-head', title));
    if (value === undefined || value === null || value === '') card.append(el('div', 'missing-value', `No ${title.toLowerCase()} was captured.`));
    else {
      const parsed = asObject(value);
      if (parsed) card.append(el('pre', 'payload-json', JSON.stringify(parsed, null, 2)));
      else {
        const body = el('div', 'response-text'); body.append(renderReadableText(String(value))); card.append(body);
      }
    }
    target.append(card);
  }
  function renderReadableText(text) {
    const root = el('div', 'rich-text');
    const lines = String(text).split(/\r?\n/);
    const inline = (container, value) => {
      const parts = String(value).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
      for (const part of parts) {
        if (part.startsWith('`') && part.endsWith('`')) container.append(el('code', '', part.slice(1, -1)));
        else if (part.startsWith('**') && part.endsWith('**')) container.append(el('strong', '', part.slice(2, -2)));
        else if (part.startsWith('*') && part.endsWith('*')) container.append(el('em', '', part.slice(1, -1)));
        else container.append(document.createTextNode(part));
      }
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^\s*```/.test(line)) {
        i++; const code = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        const pre = el('pre', 'markdown-code'); pre.append(el('code', '', code.join('\n'))); root.append(pre); continue;
      }
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
      if (heading) { const node = el(`h${Math.min(4, heading[1].length + 1)}`, 'markdown-heading'); inline(node, heading[2]); root.append(node); i++; continue; }
      if (/^\s*[-*+]\s+/.test(line)) {
        const list = el('ul', 'markdown-list');
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { const item = el('li'); inline(item, lines[i++].replace(/^\s*[-*+]\s+/, '')); list.append(item); }
        root.append(list); continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const list = el('ol', 'markdown-list');
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { const item = el('li'); inline(item, lines[i++].replace(/^\s*\d+[.)]\s+/, '')); list.append(item); }
        root.append(list); continue;
      }
      if (/^\s*>\s?/.test(line)) { const quote = el('blockquote'); inline(quote, line.replace(/^\s*>\s?/, '')); root.append(quote); i++; continue; }
      const paragraphLines = [line]; i++;
      while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^\s{0,3}#{1,6}\s/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*>/.test(lines[i])) paragraphLines.push(lines[i++]);
      const paragraph = el('p'); paragraphLines.forEach((part, lineIndex) => { if (lineIndex) paragraph.append(document.createElement('br')); inline(paragraph, part); }); root.append(paragraph);
    }
    return root;
  }
  function toast(message) {
    const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2500);
  }
  function configureAutoRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    if (state.auto) {
      const poll = async () => {
        if (!state.auto) return;
        await loadRequests(true);
        if (state.auto) refreshTimer = setTimeout(poll, 5000);
      };
      refreshTimer = setTimeout(poll, 5000);
    }
    $('#autorefresh').classList.toggle('on', state.auto);
    safeStore.set('strata-monitor.auto', String(state.auto));
  }
  function openSettings() {
    $('#base-url').value = state.base; $('#key-mode').value = state.keyMode; $('#api-key').value = state.apiKey;
    $('#settings-dialog').showModal();
  }
  function saveSettings(event) {
    event.preventDefault();
    const base = $('#base-url').value.trim().replace(/\/+$/, '');
    try { const parsed = new URL(base); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
    catch { toast('Enter a valid http:// or https:// base URL'); return; }
    state.base = base; state.keyMode = $('#key-mode').value; state.apiKey = $('#api-key').value;
    safeStore.set('strata-monitor.base', base); safeStore.set('strata-monitor.keyMode', state.keyMode);
    $('#settings-dialog').close(); loadRequests(false);
  }

  $('#refresh').addEventListener('click', () => loadRequests(true));
  $('#requests-home').addEventListener('click', () => shell.classList.remove('show-detail'));
  $('#search').addEventListener('input', (event) => { state.query = event.target.value.trim().toLowerCase(); renderList(); });
  document.querySelectorAll('.filter-chip').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); state.filter = button.dataset.filter; renderList();
  }));
  $('#autorefresh').addEventListener('click', () => { state.auto = !state.auto; configureAutoRefresh(); });
  $('#settings-open').addEventListener('click', openSettings); $('#welcome-settings').addEventListener('click', openSettings);
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#copy-id').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.detail?.id || ''); toast('Request ID copied'); } catch { toast('Could not access clipboard'); } });
  $('#copy-request').addEventListener('click', async () => {
    try {
      const raw = state.detailRaw;
      if (raw === null || raw === undefined) throw new Error('No request is selected');
      await navigator.clipboard.writeText(raw);
      toast('Raw API response copied');
    } catch { toast('Could not access clipboard'); }
  });
  $('#detail-view').addEventListener('click', (event) => { if (event.target.closest('.crumb')) { shell.classList.remove('show-detail'); } });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && shell.classList.contains('show-detail')) shell.classList.remove('show-detail'); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); } });

  configureAutoRefresh(); loadRequests(false);
})();
