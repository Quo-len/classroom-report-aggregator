const $ = id => document.getElementById(id);
let csrfToken = '';
let currentSettings = null;
let busy = false;
const phaseNames = { draft: 'Чернетка та нагадування', reconcile: 'Звірка звіту', final: 'Фінальна здача', monitor: 'Перевірка подань' };
const statusNames = { running: 'Виконується', completed: 'Завершено', failed: 'Помилка', needs_review: 'Потрібна перевірка доставки' };

function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
  $('message').hidden = !text;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...options.headers },
  });
  const data = await response.json();
  if (response.status === 401) { $('workspace').hidden = true; $('login').hidden = false; }
  if (!response.ok) throw new Error(data.error || 'Не вдалося виконати запит.');
  return data;
}

function showTab(name) {
  for (const tab of ['dashboard', 'settings']) {
    $(tab).hidden = name !== tab;
    $(`${tab}-tab`).classList.toggle('active', name === tab);
    if (name === tab) $(`${tab}-tab`).setAttribute('aria-current', 'page');
    else $(`${tab}-tab`).removeAttribute('aria-current');
  }
}

function reportLink(url, element = $('report-link')) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://docs.google.com' || !parsed.pathname.startsWith('/spreadsheets/d/')) return;
    element.href = parsed.href;
    element.hidden = false;
  } catch { /* Invalid links are not rendered. */ }
}

async function refresh() {
  if (!currentSettings) return;
  $('refresh').disabled = true;
  try {
    const data = await api('/api/status');
    const assignment = data.assignment;
    $('assignment-title').textContent = assignment?.title || 'Завдання не знайдено';
    $('assignment-dates').textContent = assignment ? `Опубліковано: ${assignment.creationDate} · Дедлайн: ${assignment.deadline}` : 'Перевірте назву завдання в налаштуваннях.';
    $('submitted').textContent = data.teachers.filter(teacher => teacher.hasSubmitted).length;
    $('missing').textContent = data.teachers.filter(teacher => !teacher.hasSubmitted).length;
    $('days').textContent = assignment?.daysRemaining == null ? '—' : assignment.daysRemaining < 0 ? 'Минув' : assignment.daysRemaining;
    $('teacher-count').textContent = `${data.teachers.length} викладачів`;
    $('teachers').replaceChildren();
    for (const teacher of data.teachers) {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = teacher.name;
      const email = document.createElement('small'); email.textContent = teacher.email; name.append(email);
      const state = document.createElement('td');
      const badge = document.createElement('span'); badge.className = `status${teacher.hasSubmitted ? ' done' : ''}`;
      badge.textContent = teacher.hasSubmitted ? 'Подано' : 'Очікуємо'; state.append(badge);
      const attachments = document.createElement('td'); attachments.textContent = teacher.attachments.join(', ') || '—';
      row.append(name, state, attachments); $('teachers').append(row);
    }
    $('empty').hidden = data.teachers.length > 0;
    document.querySelectorAll('[data-phase]').forEach(button => { button.disabled = !assignment || busy; });
    await history();
  } catch (error) { message(error.message, true); }
  finally { $('refresh').disabled = false; }
}

async function history() {
  const data = await api('/api/runs');
  $('history').replaceChildren();
  $('report-link').hidden = true;
  for (const run of data.runs) {
    const item = document.createElement('li');
    item.textContent = `${new Date(run.started_at).toLocaleString('uk-UA')} · ${phaseNames[run.phase] || run.phase} · ${statusNames[run.status] || run.status}`;
    if (run.message) { const detail = document.createElement('div'); detail.className = 'muted small'; detail.textContent = run.message; item.append(detail); }
    if (run.sheet_url) {
      const link = document.createElement('a'); link.textContent = ' Відкрити звіт ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.hidden = true;
      reportLink(run.sheet_url, link); item.append(link);
      if ($('report-link').hidden) reportLink(run.sheet_url);
    }
    $('history').append(item);
  }
  if (!data.runs.length) { const item = document.createElement('li'); item.textContent = 'Виконань ще немає.'; item.className = 'muted'; $('history').append(item); }
}

async function courses() {
  try {
    const data = await api('/api/courses');
    $('course-select').replaceChildren(new Option('Оберіть курс', ''));
    for (const course of data.courses) $('course-select').add(new Option(course.name, course.id));
    if (currentSettings) $('course-select').value = currentSettings.CLASSROOM_COURSE_ID;
    if (!data.courses.length) $('courses-help').textContent = 'Активних курсів не знайдено. Перевірте, чи ви ввійшли в обліковий запис викладача.';
  } catch (error) { message(error.message, true); }
}

function fileId(value) {
  const text = value.trim();
  if (!text.startsWith('https://')) return text;
  try {
    const url = new URL(text);
    if (!['drive.google.com', 'docs.google.com'].includes(url.hostname)) return text;
    return url.pathname.match(/\/(?:d|folders)\/([\w-]+)/)?.[1] || url.searchParams.get('id') || text;
  } catch { return text; }
}

$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('save-settings').disabled = true; message('Перевіряємо доступ до курсу й файлів…');
  try {
    const settings = Object.fromEntries(new FormData(event.target));
    for (const key of ['STATIC_PLAN_SHEET_ID', 'STATIC_SCI_PLAN_SHEET_ID', 'MASTER_OUTPUT_FOLDER_ID']) settings[key] = fileId(settings[key]);
    const automationEnabled = $('automation-enabled').checked;
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ settings, automationEnabled }) });
    currentSettings = settings;
    $('course-label').textContent = settings.ASSIGNMENT_NAME;
    $('dashboard-tab').disabled = false;
    $('automation-status').textContent = automationEnabled ? 'Автоматизацію ввімкнено' : 'Ручне виконання';
    message('Налаштування збережено.'); showTab('dashboard'); await refresh();
  } catch (error) { message(error.message, true); }
  finally { $('save-settings').disabled = false; }
});

for (const button of document.querySelectorAll('[data-phase]')) button.addEventListener('click', async () => {
  if (busy) return;
  busy = true; message('');
  document.querySelectorAll('[data-phase]').forEach(item => { item.disabled = true; });
  $('action-status').textContent = `${phaseNames[button.dataset.phase]}: виконується…`;
  try {
    const result = await api(`/api/trigger/${button.dataset.phase}`, { method: 'POST', body: '{}' });
    $('action-status').textContent = result.message || 'Виконано.';
    if (result.sheetUrl) reportLink(result.sheetUrl);
  } catch (error) { $('action-status').textContent = 'Дію не завершено.'; message(error.message, true); }
  finally { busy = false; await refresh(); }
});
$('refresh').addEventListener('click', refresh);
$('dashboard-tab').addEventListener('click', () => showTab('dashboard'));
$('settings-tab').addEventListener('click', () => showTab('settings'));
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); location.assign('/'); }
  catch (error) { message(error.message, true); }
});
$('disconnect').addEventListener('click', async () => {
  $('disconnect').disabled = true;
  try { await api('/api/disconnect', { method: 'POST', body: '{}' }); location.assign('/'); }
  catch (error) { message(error.message, true); $('disconnect').disabled = false; }
});

async function initialize() {
  try {
    const data = await api('/api/me');
    if (!data.user) {
      $('login').hidden = false;
      if (new URLSearchParams(location.search).get('login') === 'failed') message('Не вдалося підключити Google. Надайте потрібні дозволи та повторіть вхід.', true);
      return;
    }
    csrfToken = data.csrfToken; currentSettings = data.settings;
    $('account').hidden = false; $('account-name').textContent = data.user.email;
    $('workspace').hidden = false;
    $('dashboard-tab').disabled = !currentSettings || !data.user.connected;
    $('automation-enabled').checked = data.automationEnabled;
    $('automation-status').textContent = data.automationEnabled ? 'Автоматизацію ввімкнено' : 'Ручне виконання';
    if (currentSettings) {
      for (const [key, value] of Object.entries(currentSettings)) {
        const field = $('settings-form').elements.namedItem(key);
        if (field) field.value = value;
      }
      $('course-label').textContent = currentSettings.ASSIGNMENT_NAME;
    }
    if (!data.user.connected) {
      showTab('settings'); message('Google від’єднано. Натисніть «Перепідключити Google», щоб продовжити.'); return;
    }
    await courses();
    if (currentSettings) await refresh();
    else { showTab('settings'); message('Ласкаво просимо! Оберіть курс і налаштуйте звіт.'); }
  } catch (error) { message(error.message, true); $('login').hidden = false; }
  finally { $('loading').hidden = true; }
}
initialize();
