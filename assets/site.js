'use strict';
(() => {
  const data = JSON.parse(document.querySelector('#experiment-data').textContent);
  const $ = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const escape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sec = n => Number(n).toFixed(3);
  const root = document.documentElement;
  const themeButton = $('#theme-toggle');
  function setTheme(theme) {
    root.dataset.theme = theme;
    themeButton.textContent = theme === 'dark' ? 'Light' : 'Dark';
    themeButton.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    try { localStorage.setItem('temporal-sampler-theme', theme); } catch (_) { /* The page also works without storage. */ }
  }
  let theme = 'dark';
  try { theme = localStorage.getItem('temporal-sampler-theme') || 'dark'; } catch (_) { /* The default theme remains usable. */ }
  setTheme(theme === 'light' ? 'light' : 'dark');
  themeButton.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#menu-toggle').addEventListener('click', () => {
    const expanded = $('#menu-toggle').getAttribute('aria-expanded') !== 'true';
    $('#menu-toggle').setAttribute('aria-expanded', String(expanded));
    $('#site-nav').classList.toggle('open', expanded);
  });
  all('#site-nav a').forEach(a => a.addEventListener('click', () => {
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
    $('#site-nav').classList.remove('open');
  }));
  const exampleSteps = all('#example-steps > li');
  const exampleControls = $('#example-controls');
  const exampleProgress = $('#example-progress');
  const previousStep = $('#example-previous');
  const nextStep = $('#example-next');
  let exampleIndex = 0;
  function showExampleStep() {
    exampleSteps.forEach((step, index) => { step.hidden = index !== exampleIndex; });
    const title = exampleSteps[exampleIndex].querySelector('h3').textContent;
    exampleProgress.textContent = `Step ${exampleIndex + 1} of ${exampleSteps.length}: ${title}`;
    previousStep.setAttribute('aria-disabled', String(exampleIndex === 0));
    nextStep.setAttribute('aria-disabled', String(exampleIndex === exampleSteps.length - 1));
  }
  function moveExampleStep(delta) {
    const destination = exampleIndex + delta;
    if (destination < 0 || destination >= exampleSteps.length) return;
    exampleIndex = destination;
    showExampleStep();
    const heading = exampleSteps[exampleIndex].querySelector('h3');
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    exampleSteps[exampleIndex].scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  previousStep.addEventListener('click', () => moveExampleStep(-1));
  nextStep.addEventListener('click', () => moveExampleStep(1));
  showExampleStep();
  exampleProgress.hidden = false;
  exampleControls.hidden = false;
  const descriptions = {
    gateway: ['The gateway starts the job.', 'The Go gateway receives a request and starts a Workflow. One measured request used this route. The failure campaign started Workflows with the Temporal command-line tool.'],
    service: ['The Temporal Service keeps the record.', 'It stores Event History and places tasks on a Task Queue, a named waiting place for work. Workers repeatedly ask the queue for tasks. The local campaign used a Temporal dev server and a local database file.'],
    workflow: ['The Workflow chooses the order.', 'It schedules Infer, waits for its result, then schedules Report. The Worker executes this code. The Temporal Service records the decisions and outcomes.'],
    activities: ['The Activities cross the process boundary.', 'Infer asks the model service for a result and checks measurements on the average of the generated fields. Report asks an optional agent for text and uses a fixed template if that request fails.'],
    rust: ['Rust owns the actual sampler.', 'ONNX Runtime evaluates the model, and Rust runs the repeated sampling steps. In this implementation, that sampler task continues after the calling Worker disconnects.'],
    report: ['The agent writes an explanation.', 'The agent receives accepted metrics and can return text. It does not decide whether the field passed the physics gate. Report returns a fixed template when the agent call fails.']
  };
  all('#architecture button[data-node]').forEach(button => button.addEventListener('click', () => {
    all('#architecture button[data-node]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    const [title, body] = descriptions[button.dataset.node];
    $('#node-detail').innerHTML = `<strong>${escape(title)}</strong> ${escape(body)}`;
  }));
  const scenario = $('#scenario-select');
  const runSelect = $('#run-select');
  function renderRun() {
    const r = data.runs.find(x => x.id === runSelect.value);
    if (!r) return;
    const mobile = window.innerWidth < 650;
    const width = mobile ? 330 : 930;
    const left = mobile ? 12 : 120;
    const right = 15;
    const top = 52;
    const gap = 58;
    const samples = r.samples || [];
    const height = Math.max(170, top + samples.length * gap + 45);
    const maxTime = Math.max(r.total_seconds, ...samples.map(s => s.end_s));
    const x = t => left + (width - left - right) * t / maxTime;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="timeline-title-svg timeline-desc-svg"><title id="timeline-title-svg">Sampler intervals for ${escape(r.id)}</title><desc id="timeline-desc-svg">The saved Workflow duration was ${sec(r.total_seconds)} seconds. The record contains ${samples.length} sampler runs. Bars show recorded start and end times.</desc>`;
    const ink = root.dataset.theme === 'light' ? '#5e6175' : '#b2b4c6';
    svg += `<text x="${left}" y="22" fill="${ink}" font-size="12" font-family="Inter">${escape(r.id)} · ${sec(r.total_seconds)} s Workflow time</text>`;
    if (!samples.length) {
      svg += `<text x="${left}" y="75" fill="${ink}" font-size="13" font-family="Inter">The sampler did not run.</text>`;
    }
    samples.forEach((s, i) => {
      const y = top + i * gap;
      const label = i === 0 ? 'First run' : 'Second run';
      if (!mobile) svg += `<text x="0" y="${y + 17}" fill="${ink}" font-size="12" font-family="Inter">${label}</text>`;
      svg += `<rect x="${x(s.start_s)}" y="${y}" width="${Math.max(2, x(s.end_s) - x(s.start_s))}" height="24" rx="3" fill="${i === 0 ? '#7f86f1' : '#34d399'}"/><text x="${left}" y="${y + 43}" fill="${ink}" font-size="${mobile ? 10 : 12}" font-family="Inter">${mobile ? label + ': ' : ''}${sec(s.start_s)} s to ${sec(s.end_s)} s</text>`;
    });
    const workerKilled = ['f1-hb', 'f1-nohb', 'f6'].includes(r.scenario) && r.kill_offset_s != null;
    $('#kill-legend').hidden = !workerKilled;
    if (workerKilled) {
      const k = x(r.kill_offset_s);
      svg += `<line x1="${k}" x2="${k}" y1="36" y2="${height - 40}" stroke="#fecb2f" stroke-width="2" stroke-dasharray="5 4"/><text x="${Math.min(width - 85, k + 5)}" y="38" fill="${root.dataset.theme === 'light' ? '#815400' : '#ffd277'}" font-size="11" font-family="Inter">Worker killed</text>`;
    }
    svg += `<line x1="${left}" y1="${height - 30}" x2="${width - right}" y2="${height - 30}" stroke="${ink}" opacity=".4"/><text x="${left}" y="${height - 9}" fill="${ink}" font-size="11" font-family="Inter">Seconds since the runner began the request</text></svg>`;
    $('#timeline').innerHTML = svg;
    const intervals = samples.length ? samples.map((sample, index) => `Sampler run ${index + 1} started at ${sec(sample.start_s)} seconds and ended at ${sec(sample.end_s)} seconds`).join('. ') : 'The sampler did not run';
    const killDescription = workerKilled ? `. The Worker kill command was at ${sec(r.kill_offset_s)} seconds` : '';
    $('#timeline').setAttribute('aria-label', `Run ${r.id}. Workflow time ${sec(r.total_seconds)} seconds. ${intervals}${killDescription}. Sampler and kill offsets are relative to when the runner began the request. Workflow duration uses the Workflow-start event as its starting point.`);
  }
  function renderScenario() {
    const g = data.groups.find(x => x.key === scenario.value);
    const rr = data.runs.filter(x => x.scenario === g.key);
    const interval = g.interval == null ? 'Not applicable' : g.interval === 'UNVERIFIED' ? 'UNVERIFIED' : `${g.interval} s`;
    const notes = {
      f2: 'The inference service returned during the retry window. The first retry start is UNVERIFIED because the experiment checked Temporal for pending Activity status at intervals and the fast failed attempts ended between those checks.',
      f4: 'The request disabled projection, a step that adjusts the output, and used 20 steps. The physics gate checked the average of the generated fields and failed. The resulting Non-Retryable Error stopped retries. This shorter request is not a baseline timing comparison.',
      f6: 'The test forcibly stopped the Worker and started a newer one. The scheduled Activity retained its old options without a Heartbeat Timeout. This covers one code transition.'
    };
    const ending = g.outcome === 'COMPLETED' ? 'The Workflow completed.' : 'The Workflow failed.';
    $('#scenario-summary').innerHTML = `<p class="badge">${ending}</p><div class="metric-row"><div><span class="metric-value">${g.total} s</span><span class="metric-label">The median Workflow duration</span></div><div><span class="metric-value">${g.attempts}</span><span class="metric-label">Infer attempts in each run</span></div><div><span class="metric-value">${g.samples}</span><span class="metric-label">Sampler runs in each run</span></div><div><span class="metric-value" style="${interval.length > 13 ? 'font-size:1.05rem' : ''}">${interval}</span><span class="metric-label">The median failure-to-next-attempt interval</span></div></div><p class="scenario-note">${escape(notes[g.key] || g.note.replace('with SIGKILL', 'with SIGKILL, which forcibly stops the process'))}</p><p class="source">The observed Workflow range was ${g.range} seconds. The configured Heartbeat Timeout was ${g.heartbeat}. Start-To-Close was 2 minutes. ${g.interval && g.interval !== 'UNVERIFIED' ? 'The measured interval is consistent with the chosen timeout setting and includes backoff, Worker availability and dispatch delay.' : ''}</p>`;
    runSelect.innerHTML = rr.map(r => `<option value="${r.id}">${r.id}</option>`).join('');
    const median = rr.slice().sort((a,b) => a.total_seconds - b.total_seconds)[Math.floor(rr.length / 2)];
    runSelect.value = median.id;
    $('#run-table').innerHTML = rr.map(r => `<tr><td>${r.id}</td><td>${sec(r.total_seconds)}</td><td>${r.infer_attempts}</td><td>${r.sample_count}</td><td>${r.scenario === 'f2' ? 'UNVERIFIED' : r.failure_to_next_attempt_s == null ? 'Not applicable' : sec(r.failure_to_next_attempt_s) + ' s'}</td></tr>`).join('');
    renderRun();
  }
  scenario.addEventListener('change', renderScenario);
  runSelect.addEventListener('change', renderRun);
  themeButton.addEventListener('click', renderRun);
  window.addEventListener('resize', renderRun);
  renderScenario();
  function replay() {
    const mismatch = $('#replay-variant').value === 'timer';
    $('#replay-output').innerHTML = `<div class="replay-grid"><div><h3>The saved history expects this path.</h3><ol class="event-list"><li>Infer is scheduled.</li><li>Infer completes and its result is recorded.</li><li>Report is scheduled.</li></ol></div><div><h3>The Workflow follows this path during replay.</h3><ol class="event-list">${mismatch ? '<li class="mismatch">A timer is scheduled before Infer.</li><li>Infer would come later.</li>' : '<li>The Workflow decides to schedule Infer.</li><li>History supplies the recorded Infer result.</li><li>The Workflow decides to schedule Report.</li>'}</ol></div></div><p class="replay-verdict ${mismatch ? 'fail' : ''}">${mismatch ? 'The first decision differs. This illustration shows why the inserted timer conflicts with the saved path.' : 'The illustrated decisions match. The completed inference result comes from the history during replay.'}</p><p class="source">This browser illustration explains the recorded test. It is not a Temporal Replayer and does not execute Workflow code.</p>`;
  }
  $('#replay-variant').addEventListener('change', replay);
  replay();
  const entries = all('.glossary-entry');
  $('#glossary-search').addEventListener('input', () => {
    const query = $('#glossary-search').value.trim().toLowerCase();
    let count = 0;
    entries.forEach(e => { e.hidden = !e.textContent.toLowerCase().includes(query); if (!e.hidden) count++; });
    $('#glossary-count').textContent = count ? `The search matches ${count} ${count === 1 ? 'entry' : 'entries'}.` : 'No entry matches. Try a broader term.';
  });
  all('.copy-button').forEach(b => b.addEventListener('click', async () => {
    const text = document.getElementById(b.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; }
    catch (_) { const range = document.createRange(); range.selectNodeContents(document.getElementById(b.dataset.copy)); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); b.textContent = 'The code is selected'; }
  }));
  const updateProgress = () => {
    const length = document.documentElement.scrollHeight - window.innerHeight;
    $('#reading-progress').style.width = `${length > 0 ? Math.min(100, 100 * window.scrollY / length) : 0}%`;
  };
  window.addEventListener('scroll', updateProgress, {passive:true});
  updateProgress();
})();
