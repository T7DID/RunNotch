(() => {
  'use strict';

  const api = window.runnotch;
  const app = document.querySelector('#app');
  const notch = document.querySelector('#notch');
  const list = document.querySelector('#job-list');
  const card = document.querySelector('#detail-card');
  const tail = document.querySelector('#card-tail');
  const wakePill = document.querySelector('#wake-pill');
  const settingsButton = document.querySelector('#settings-button');
  const announcer = document.querySelector('#announcer');

  const state = {
    jobs: [],
    notchOpen: false,
    selectedId: null,
    cardMode: null,
    hideTimer: null,
    settings: null,
    stopConfirmId: null,
    feedback: null
  };

  const NS = 'http://www.w3.org/2000/svg';
  const activeStates = new Set(['running', 'attention', 'stopping']);
  const labels = {
    running: 'Running',
    attention: 'Needs attention',
    stopping: 'Stopping',
    success: 'Finished',
    failed: 'Failed',
    interrupted: 'Interrupted'
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgElement(tag, attributes = {}) {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  }

  function iconSvg(kind) {
    const svg = svgElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' });
    if (kind === 'copy') {
      svg.append(svgElement('rect', { x: 5, y: 5, width: 8, height: 8, rx: 1.5 }));
      svg.append(svgElement('path', { d: 'M3 10V4.5C3 3.7 3.7 3 4.5 3H10' }));
    } else {
      svg.append(svgElement('path', { d: 'M3 3l10 10M13 3 3 13' }));
    }
    return svg;
  }

  function statusValue(job) {
    if (Number.isFinite(job.progress)) return `${Math.round(job.progress)}%`;
    if (job.status === 'success') return 'DONE';
    if (job.status === 'failed') return 'FAIL';
    if (job.status === 'interrupted') return 'LOST';
    if (job.status === 'attention') return 'WAIT';
    if (job.status === 'stopping') return 'STOP';
    return elapsedCompact(job.startedAt);
  }

  function elapsedCompact(startedAt, endedAt = Date.now()) {
    const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  }

  function elapsedLong(job) {
    const end = job.finishedAt || Date.now();
    const seconds = Math.max(0, Math.round((end - job.startedAt) / 1000));
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  }

  function glyph(job) {
    const cleaned = String(job.name || '').trim();
    return (cleaned.match(/[A-Za-z0-9]/)?.[0] || '>').toUpperCase();
  }

  function accessibleLabel(job) {
    const progress = Number.isFinite(job.progress) ? `, ${Math.round(job.progress)} percent` : '';
    return `${job.name}, ${labels[job.status] || job.status}${progress}, ${elapsedLong(job)}`;
  }

  function renderCell(job) {
    const button = element('button', `job-cell ${job.status}${Number.isFinite(job.progress) ? '' : ' unknown'}`);
    button.type = 'button';
    button.dataset.id = job.id;
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-label', accessibleLabel(job));
    button.setAttribute('aria-current', state.selectedId === job.id ? 'true' : 'false');

    const ring = element('span', 'ring-wrap');
    ring.style.setProperty('--progress', String(Number.isFinite(job.progress) ? job.progress : job.status === 'success' ? 100 : 0));
    const svg = svgElement('svg', { class: 'ring-svg', viewBox: '0 0 48 48', 'aria-hidden': 'true' });
    svg.append(svgElement('circle', { class: 'ring-track', cx: 24, cy: 24, r: 20 }));
    svg.append(svgElement('circle', { class: 'ring-value', cx: 24, cy: 24, r: 20 }));
    svg.append(svgElement('circle', { class: 'activity-arc', cx: 24, cy: 24, r: 16 }));
    ring.append(svg, element('span', 'job-glyph', glyph(job)));
    button.append(ring, element('span', 'job-label', statusValue(job)));

    const show = () => openJob(job.id);
    button.addEventListener('pointerenter', show);
    button.addEventListener('focus', show);
    button.addEventListener('click', show);
    return button;
  }

  function render() {
    list.replaceChildren(...state.jobs.map(renderCell));
    notch.classList.toggle('empty', state.jobs.length === 0);
    notch.classList.toggle('collapsed', !state.notchOpen);
    notch.classList.toggle('has-active', state.jobs.some((job) => activeStates.has(job.status)));
    notch.classList.toggle('has-attention', state.jobs.some((job) => job.status === 'attention' || job.status === 'failed'));
    wakePill.setAttribute('aria-expanded', String(state.notchOpen));
    if (state.cardMode === 'job') renderJobCard();
    if (state.cardMode === 'settings') renderSettingsCard();
    if (state.cardMode === 'empty') renderEmptyCard();
    requestAnimationFrame(reportHeight);
  }

  function reportHeight() {
    const notchHeight = Math.max(104, Math.ceil(notch.scrollHeight + 58));
    const cardHeight = card.hidden ? 0 : Math.ceil(card.scrollHeight + 20);
    api.setHeight(Math.max(168, Math.min(620, Math.max(notchHeight, cardHeight))));
  }

  function setNotchOpen(open) {
    state.notchOpen = Boolean(open);
    notch.classList.toggle('collapsed', !state.notchOpen);
    wakePill.setAttribute('aria-expanded', String(state.notchOpen));
    api.setNotchOpen(state.notchOpen);
    requestAnimationFrame(reportHeight);
  }

  function openNotch() {
    clearTimeout(state.hideTimer);
    setNotchOpen(true);
  }

  function openCardWindow() {
    openNotch();
    api.setExpanded(true);
  }

  function closeCard({ immediate = false } = {}) {
    clearTimeout(state.hideTimer);
    const close = () => {
      state.cardMode = null;
      state.selectedId = null;
      state.stopConfirmId = null;
      state.feedback = null;
      card.hidden = true;
      tail.hidden = true;
      card.replaceChildren();
      api.setExpanded(false);
      setNotchOpen(false);
      render();
    };
    if (immediate) close();
    else state.hideTimer = setTimeout(close, 260);
  }

  function openJob(id) {
    const job = state.jobs.find((item) => item.id === id);
    if (!job) return;
    clearTimeout(state.hideTimer);
    state.selectedId = id;
    state.cardMode = 'job';
    state.stopConfirmId = null;
    state.feedback = null;
    card.hidden = false;
    tail.hidden = false;
    openCardWindow();
    render();
  }

  function openEmpty() {
    if (state.jobs.length) return;
    clearTimeout(state.hideTimer);
    state.cardMode = 'empty';
    card.hidden = false;
    tail.hidden = false;
    openCardWindow();
    renderEmptyCard();
  }

  function statusBadge(job) {
    const badge = element('span', `status-badge ${job.status}`);
    badge.append(element('span', 'status-dot'), document.createTextNode(labels[job.status] || job.status));
    return badge;
  }

  function metric(label, value) {
    const node = element('div', 'metric');
    node.append(element('span', 'metric-label', label), element('span', 'metric-value', value));
    return node;
  }

  function action(label, handler, options = {}) {
    const button = element('button', `${options.danger ? 'danger-button' : 'action-button'}${options.primary ? ' primary' : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function renderJobCard() {
    const job = state.jobs.find((item) => item.id === state.selectedId);
    if (!job) {
      state.cardMode = state.jobs.length ? null : 'empty';
      if (state.cardMode === 'empty') renderEmptyCard();
      else closeCard({ immediate: true });
      return;
    }
    card.replaceChildren();

    const head = element('div', 'card-head');
    const titles = element('div', 'card-title-wrap');
    titles.append(element('h2', 'card-title', job.name), element('p', 'card-subtitle', job.cwd || 'Working directory unavailable'), statusBadge(job));
    head.append(element('div', 'card-icon', glyph(job)), titles);

    const metrics = element('div', 'metric-grid');
    metrics.append(
      metric('Elapsed', elapsedLong(job)),
      metric('Progress', Number.isFinite(job.progress) ? `${Math.round(job.progress)}%` : labels[job.status] || 'Unknown')
    );
    if (Number.isInteger(job.exitCode)) metrics.append(metric('Exit code', String(job.exitCode)));
    metrics.append(metric('Process', job.childPid ? `PID ${job.childPid}` : 'Unavailable'));

    const commandLabel = element('div', 'section-label', 'Command');
    const command = element('div', 'command-box', job.command || 'Command unavailable');
    const outputLabel = element('div', 'section-label', 'Latest output');
    const output = element('pre', `log-box${job.stream === 'stderr' ? ' error' : ''}`, job.lastLines.length ? job.lastLines.slice(-12).join('\n') : 'Waiting for output…');

    const actions = element('div', 'card-actions');
    actions.append(
      action('Focus terminal', async () => {
        state.feedback = 'Opening the terminal…';
        renderJobCard();
        const result = await api.focusJob(job.id);
        state.feedback = result.fallback ? 'Could not identify the terminal tab. Opened the working folder instead.' : 'Terminal focused.';
        renderJobCard();
      }, { primary: true }),
      action('Open folder', async () => {
        const result = await api.openFolder(job.id);
        state.feedback = result.ok ? 'Folder opened.' : `Could not open the folder${result.error ? `: ${result.error}` : '.'}`;
        renderJobCard();
      })
    );
    if (activeStates.has(job.status)) {
      actions.append(action('Stop run', () => { state.stopConfirmId = job.id; renderJobCard(); }, { danger: true }));
    } else {
      actions.append(action('Dismiss', async () => { await api.removeJob(job.id); closeCard({ immediate: true }); }));
    }

    card.append(head, metrics, commandLabel, command, outputLabel, output, actions);
    if (state.stopConfirmId === job.id) card.append(renderStopConfirmation(job));
    if (state.feedback) card.append(element('p', `feedback${state.feedback.startsWith('Could not') ? ' error' : ''}`, state.feedback));
    requestAnimationFrame(reportHeight);
  }

  function renderStopConfirmation(job) {
    const box = element('div', 'confirmation');
    box.append(element('p', '', `Stop “${job.name}” and its child processes? Unsaved work inside the command may be lost.`));
    const actions = element('div', 'card-actions');
    actions.append(
      action('Cancel', () => { state.stopConfirmId = null; renderJobCard(); }),
      action('Stop run', async () => {
        state.feedback = 'Stopping the process…';
        state.stopConfirmId = null;
        renderJobCard();
        try {
          await api.stopJob(job.id);
          state.feedback = 'Stop signal sent.';
        } catch (error) {
          state.feedback = `Could not stop the process: ${error.message}`;
        }
        renderJobCard();
      }, { danger: true })
    );
    box.append(actions);
    return box;
  }

  function renderEmptyCard() {
    card.replaceChildren();
    card.append(
      element('h2', 'empty-title', 'No runs yet'),
      element('p', 'empty-copy', 'Wrap any long command. RunNotch will track it and alert you when it finishes.')
    );
    const quick = element('div', 'quick-command', 'runnotch npm test');
    const copy = element('button', 'copy-button');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy example command');
    copy.title = 'Copy';
    copy.append(iconSvg('copy'));
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText('runnotch npm test');
      announcer.textContent = 'Example command copied.';
      state.feedback = 'Copied.';
      renderEmptyCard();
    });
    quick.append(copy);
    card.append(quick);
    if (state.feedback) card.append(element('p', 'feedback', state.feedback));
    requestAnimationFrame(reportHeight);
  }

  function settingSwitch(name, hint, key) {
    const row = element('div', 'setting-row');
    const copy = element('div', 'setting-copy');
    copy.append(element('span', 'setting-name', name), element('span', 'setting-hint', hint));
    const button = element('button', 'switch');
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-checked', String(Boolean(state.settings?.[key])));
    button.addEventListener('click', async () => {
      state.settings = await api.updateSettings({ [key]: !state.settings[key] });
      announcer.textContent = `${name} ${state.settings[key] ? 'enabled' : 'disabled'}.`;
      renderSettingsCard();
    });
    row.append(copy, button);
    return row;
  }

  function renderSettingsCard() {
    card.replaceChildren();
    const toolbar = element('div', 'card-toolbar');
    toolbar.append(element('h2', 'card-title', 'RunNotch settings'));
    const close = element('button', 'close-button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close settings');
    close.append(iconSvg('close'));
    close.addEventListener('click', () => closeCard({ immediate: true }));
    toolbar.append(close);

    const group = element('div', 'settings-group');
    group.append(
      settingSwitch('Launch with Windows', 'Keep the edge tab ready after you sign in.', 'launchAtStartup'),
      settingSwitch('Success notifications', 'Notify when a run finishes.', 'notifySuccess'),
      settingSwitch('Failure notifications', 'Notify when a run exits with an error.', 'notifyFailure'),
      settingSwitch('Notification sound', 'Use the system notification sound.', 'sound')
    );

    const retention = element('div', 'setting-row');
    const retentionCopy = element('div', 'setting-copy');
    retentionCopy.append(element('span', 'setting-name', 'Keep finished runs'), element('span', 'setting-hint', 'Active runs are never removed.'));
    const select = element('select', 'retention-select');
    select.setAttribute('aria-label', 'Keep finished runs');
    for (const [value, label] of [['5', '5 minutes'], ['15', '15 minutes'], ['60', '1 hour'], ['0', 'Until dismissed']]) {
      const option = element('option', '', label);
      option.value = value;
      option.selected = Number(value) === state.settings?.keepFinishedMinutes;
      select.append(option);
    }
    select.addEventListener('change', async () => {
      state.settings = await api.updateSettings({ keepFinishedMinutes: Number(select.value) });
      announcer.textContent = 'Retention updated.';
      renderSettingsCard();
    });
    retention.append(retentionCopy, select);
    group.append(retention);

    const actions = element('div', 'card-actions');
    const hasFinished = state.jobs.some((job) => !activeStates.has(job.status));
    const clear = action('Clear finished', async () => { await api.clearFinished(); state.feedback = 'Finished runs cleared.'; renderSettingsCard(); });
    clear.disabled = !hasFinished;
    actions.append(clear);

    card.append(toolbar, element('p', 'card-subtitle', 'Changes apply immediately and stay on this device.'), group, actions);
    if (state.feedback) card.append(element('p', 'feedback', state.feedback));
    requestAnimationFrame(reportHeight);
  }

  async function openSettings() {
    clearTimeout(state.hideTimer);
    state.settings = state.settings || await api.getSettings();
    state.cardMode = 'settings';
    state.feedback = null;
    card.hidden = false;
    tail.hidden = false;
    openCardWindow();
    renderSettingsCard();
  }

  app.addEventListener('pointerenter', openNotch);
  app.addEventListener('pointerleave', () => closeCard());
  app.addEventListener('focusin', openNotch);
  app.addEventListener('focusout', (event) => {
    if (!app.contains(event.relatedTarget)) closeCard();
  });
  app.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCard({ immediate: true });
  });
  notch.addEventListener('pointerenter', () => { if (!state.jobs.length) openEmpty(); });
  wakePill.addEventListener('click', openNotch);
  wakePill.addEventListener('focus', () => {
    openNotch();
    requestAnimationFrame(() => (list.querySelector('button') || settingsButton).focus());
  });
  settingsButton.addEventListener('click', openSettings);

  api.onJobs((jobs) => {
    const previous = new Map(state.jobs.map((job) => [job.id, job.status]));
    state.jobs = jobs;
    for (const job of jobs) {
      if (previous.has(job.id) && previous.get(job.id) !== job.status) announcer.textContent = `${job.name}: ${labels[job.status] || job.status}.`;
    }
    render();
  });
  api.onOpenSettings(openSettings);
  api.onReveal(openNotch);
  api.onCapture(() => {
    setTimeout(() => {
      if (state.jobs.length) openJob(state.jobs[0].id);
      else openEmpty();
    }, 120);
  });

  Promise.all([api.listJobs(), api.getSettings()]).then(([jobs, settings]) => {
    state.jobs = jobs;
    state.settings = settings;
    render();
  });

  setInterval(() => {
    if (state.jobs.some((job) => activeStates.has(job.status))) render();
  }, 1_000);
})();
