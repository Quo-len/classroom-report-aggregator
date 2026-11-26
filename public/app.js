const $ = id => document.getElementById(id);
let csrfToken = '';
let currentSettings = null;
let me = null;
let busy = false;
const phaseNames = { draft: 'Чернетка та нагадування', reconcile: 'Звірка звіту', final: 'Фінальна здача', monitor: 'Перевірка подань' };
const statusNames = { running: 'Виконується', completed: 'Завершено', failed: 'Помилка', needs_review: 'Потрібна перевірка доставки' };
const roleNames = { admin: 'Адміністратор', editor: 'Редактор', viewer: 'Перегляд', disabled: 'Заблоковано' };
const workspaceLabels = {
  rootFolderUrl: 'Папка кафедри', reportsFolderUrl: 'Зведені звіти',
  planSheetUrl: 'План роботи кафедри', sciPlanSheetUrl: 'План наукової роботи кафедри',
};
const allowed = permission => Boolean(me?.user.permissions.includes(permission));

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
  for (const tab of ['dashboard', 'settings', 'admin']) {
    $(tab).hidden = name !== tab;
    $(`${tab}-tab`).classList.toggle('active', name === tab);
    if (name === tab) $(`${tab}-tab`).setAttribute('aria-current', 'page');
    else $(`${tab}-tab`).removeAttribute('aria-current');
  }
  if (name === 'admin') loadUsers();
}

function safeLink(url, hosts) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && hosts.includes(parsed.hostname) ? parsed.href : null;
  } catch { return null; }
}

function reportLink(url, element = $('report-link')) {
  const href = safeLink(url, ['docs.google.com']);
  if (!href || !new URL(href).pathname.startsWith('/spreadsheets/d/')) return;
  element.href = href;
  element.hidden = false;
}

function renderWorkspace(workspace) {
  const list = $('workspace-links');
  list.replaceChildren();
  for (const [key, label] of Object.entries(workspaceLabels)) {
    const href = workspace && safeLink(workspace[key] || '', ['docs.google.com', 'drive.google.com']);
    if (!href) continue;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${label} ↗`;
    item.append(link); list.append(item);
  }
  list.hidden = !list.children.length;
}

function renderCourse(course) {
  $('course-resolved').hidden = !course;
  $('course-resolved').classList.remove('error');
  if (course) $('course-resolved').textContent = `✓ Обраний курс: ${course.name}`;
  $('course-label').textContent = [course?.name, currentSettings?.ASSIGNMENT_NAME].filter(Boolean).join(' · ');
}

async function refresh() {
  if (!currentSettings) return;
  $('refresh').disabled = true;
  try {
    const data = await api('/api/status');
    const assignment = data.assignment;
    $('assignment-title').textContent = assignment?.title || 'Завдання не знайдено';
    $('assignment-dates').textContent = assignment ? `Опубліковано: ${assignment.creationDate} · Дедлайн: ${assignment.deadline}` : 'Перевірте назву завдання та курс у налаштуваннях.';
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
    $('course-options').replaceChildren(...data.courses.map(course => new Option(course.name)));
    if (!data.courses.length) $('courses-help').textContent = 'Активних курсів не знайдено. Перевірте, чи ви ввійшли в обліковий запис викладача.';
    else if (data.courses.length === 1 && !$('course-name').value) $('course-name').placeholder = data.courses[0].name;
  } catch (error) { message(error.message, true); }
}

async function loadUsers() {
  if (!allowed('users:manage')) return;
  $('admin-refresh').disabled = true;
  try {
    const data = await api('/api/admin/users');
    $('users').replaceChildren();
    for (const user of data.users) {
      const row = document.createElement('tr');
      const who = document.createElement('td'); who.textContent = user.name;
      const email = document.createElement('small'); email.textContent = user.email; who.append(email);
      const roleCell = document.createElement('td');
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Роль: ${user.email}`);
      for (const [value, label] of Object.entries(roleNames)) select.add(new Option(label, value, false, value === user.role));
      select.disabled = user.self;
      select.title = select.disabled ? 'Власну роль може змінити лише інший адміністратор' : '';
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await api(`/api/admin/users/${encodeURIComponent(user.id)}/role`, { method: 'PUT', body: JSON.stringify({ role: select.value }) });
          message(`Роль ${user.email}: ${roleNames[select.value]}.`);
        } catch (error) { message(error.message, true); }
        await loadUsers();
      });
      roleCell.append(select);
      const state = document.createElement('td');
      for (const [flag, label] of [[user.connected, 'Google підключено'], [user.configured, 'Налаштовано'], [user.automation_enabled, 'Автоматизація']]) {
        if (!flag) continue;
        const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = label; state.append(chip);
      }
      if (!state.children.length) state.textContent = '—';
      const last = document.createElement('td');
      last.textContent = user.last_run_at ? new Date(user.last_run_at).toLocaleString('uk-UA') : '—';
      row.append(who, roleCell, state, last); $('users').append(row);
    }
    $('audit').replaceChildren();
    for (const event of data.audit) {
      const item = document.createElement('li');
      const change = event.action === 'role.changed'
        ? `${event.actor || '—'} змінив(ла) роль ${event.target || '—'}: ${roleNames[event.detail.from] || event.detail.from} → ${roleNames[event.detail.to] || event.detail.to}`
        : `${event.target || '—'} зареєструвався(лася) з роллю «${roleNames[event.detail.role] || event.detail.role}»`;
      item.textContent = `${new Date(event.created_at).toLocaleString('uk-UA')} · ${change}`;
      $('audit').append(item);
    }
    if (!data.audit.length) { const item = document.createElement('li'); item.className = 'muted'; item.textContent = 'Подій ще немає.'; $('audit').append(item); }
  } catch (error) { message(error.message, true); }
  finally { $('admin-refresh').disabled = false; }
}

function fillSettings(settings) {
  const defaults = me.defaults;
  const values = { ASSIGNMENT_NAME: defaults.ASSIGNMENT_NAME, HEAD_OF_DEPT_EMAIL: defaults.HEAD_OF_DEPT_EMAIL, ...(settings || {}) };
  for (const [key, value] of Object.entries(values)) {
    const field = $('settings-form').elements.namedItem(key);
    if (field && typeof value === 'string') field.value = value;
  }
}

$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('save-settings').disabled = true;
  message('Шукаємо курс і готуємо папку на Google Диску…');
  try {
    const settings = Object.fromEntries(new FormData(event.target));
    const automationEnabled = $('automation-enabled').checked;
    const result = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ settings, automationEnabled }) });
    currentSettings = result.settings;
    fillSettings(currentSettings);
    renderCourse(result.course);
    renderWorkspace(result.workspace);
    $('dashboard-tab').disabled = false;
    $('automation-status').textContent = automationEnabled ? 'Автоматизацію ввімкнено' : 'Ручне виконання';
    message(`Налаштування збережено. Курс: ${result.course.name}.`); showTab('dashboard'); await refresh();
  } catch (error) {
    message(error.message, true);
    $('course-resolved').hidden = false; $('course-resolved').classList.add('error'); $('course-resolved').textContent = error.message;
  } finally { $('save-settings').disabled = false; }
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
$('admin-refresh').addEventListener('click', loadUsers);
$('dashboard-tab').addEventListener('click', () => showTab('dashboard'));
$('settings-tab').addEventListener('click', () => showTab('settings'));
$('admin-tab').addEventListener('click', () => showTab('admin'));
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
    me = await api('/api/me');
    if (!me.user) {
      $('login').hidden = false;
      const reason = new URLSearchParams(location.search).get('login');
      if (reason === 'failed') message('Не вдалося підключити Google. Надайте потрібні дозволи та повторіть вхід.', true);
      if (reason === 'disabled') message('Ваш обліковий запис заблоковано. Зверніться до адміністратора.', true);
      return;
    }
    csrfToken = me.csrfToken; currentSettings = me.settings;
    const canEdit = allowed('settings:write');
    $('account').hidden = false; $('account-name').textContent = me.user.email;
    $('account-role').textContent = roleNames[me.user.role] || me.user.role;
    $('workspace').hidden = false;
    $('admin-tab').hidden = !allowed('users:manage');
    $('readonly-note').hidden = canEdit;
    $('settings-fields').disabled = !canEdit;
    $('phase-actions').hidden = !allowed('workflow:run');
    $('dashboard-tab').disabled = !currentSettings || !me.user.connected;
    $('automation-enabled').checked = me.automationEnabled;
    $('automation-status').textContent = me.automationEnabled ? 'Автоматизацію ввімкнено' : 'Ручне виконання';
    $('default-assignment').textContent = `«${me.defaults.ASSIGNMENT_NAME}»`;
    $('workspace-name').textContent = `«${me.defaults.WORKSPACE_FOLDER_NAME}»`;
    fillSettings(currentSettings);
    renderCourse(me.course);
    renderWorkspace(me.workspace);
    if (!me.user.connected) {
      showTab('settings'); message('Google від’єднано. Натисніть «Перепідключити Google», щоб продовжити.'); return;
    }
    if (canEdit) await courses();
    if (currentSettings) await refresh();
    else if (canEdit) { showTab('settings'); message('Ласкаво просимо! Вкажіть назву курсу — папку й таблиці на Google Диску буде створено автоматично.'); }
    else showTab('settings');
  } catch (error) { message(error.message, true); $('login').hidden = false; }
  finally { $('loading').hidden = true; }
}
initialize();

$('connect-telegram').addEventListener('click', async () => {
  try {
    const result = await api('/api/telegram/connect', { method: 'POST', body: '{}' });
    const url = safeLink(result.url, ['t.me']);
    if (url) { $('telegram-link').href = url; $('telegram-link').hidden = false; }
  } catch (error) { message(error.message, true); }
});
