import assert from 'assert/strict';
import fs from 'fs/promises';
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let signedIn = false;
  let role = 'admin';
  let settings: Record<string, string> | null = null;
  let triggerBody: unknown;
  let roleChange: unknown;
  const permissions: Record<string, string[]> = {
    admin: ['account:self', 'report:read', 'settings:write', 'workflow:run', 'users:manage'],
    viewer: ['account:self', 'report:read'],
  };
  const course = { id: 'course-1', name: 'Кафедра інформатики · 2026' };
  const workspace = {
    rootFolderUrl: 'https://drive.google.com/drive/folders/root', reportsFolderUrl: 'https://drive.google.com/drive/folders/reports',
    planSheetUrl: 'https://docs.google.com/spreadsheets/d/plan/edit', sciPlanSheetUrl: 'https://docs.google.com/spreadsheets/d/sci/edit',
  };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://bird.test') { await route.abort(); return; }
    const pathname = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (pathname === '/api/me') return json({
      user: signedIn ? { email: 'user@example.com', connected: true, role, permissions: permissions[role] } : null,
      settings, csrfToken: 'test-csrf', course: settings ? course : null, workspace: settings ? workspace : {},
      defaults: { ASSIGNMENT_NAME: 'Інформація про науково-дослідну роботу', HEAD_OF_DEPT_EMAIL: 'user@example.com', WORKSPACE_FOLDER_NAME: 'Секретар кафедри' },
    });
    if (pathname === '/api/courses') return json({ courses: [course] });
    if (pathname === '/api/settings') {
      assert.equal(route.request().headers()['x-csrf-token'], 'test-csrf');
      settings = route.request().postDataJSON().settings;
      return json({ ok: true, settings, course, workspace });
    }
    if (pathname === '/api/status') return json({
      assignment: { title: 'Інформація про науково-дослідну роботу', creationDate: '20 листопада 2026', deadline: '28 листопада 2026', daysRemaining: 3 },
      teachers: [
        { name: 'Іваненко Олена', email: 'olena@example.com', hasSubmitted: true, attachments: ['Науковий звіт.docx'] },
        { name: 'Петренко Андрій', email: 'andrii@example.com', hasSubmitted: false, attachments: [] },
      ],
    });
    if (pathname === '/api/runs') return json({ runs: triggerBody ? [{
      phase: 'draft', status: 'completed', started_at: '2026-11-25T09:00:00Z',
      sheet_url: 'https://docs.google.com/spreadsheets/d/report/edit',
    }] : [] });
    if (pathname === '/api/admin/users') return json({
      users: [
        { id: 'u1', self: true, email: 'user@example.com', name: 'Адмін', role: 'admin', connected: true, configured: true, automation_enabled: false, last_run_at: null },
        { id: 'u2', self: false, email: 'colleague@example.com', name: 'Колега', role: 'editor', connected: true, configured: false, automation_enabled: false, last_run_at: null },
      ],
      audit: [{ action: 'role.changed', detail: { from: 'viewer', to: 'editor' }, created_at: '2026-11-25T10:00:00Z', actor: 'user@example.com', target: 'colleague@example.com' }],
    });
    if (pathname === '/api/admin/users/u2/role') { roleChange = route.request().postDataJSON(); return json({ ok: true }); }
    if (pathname.startsWith('/api/trigger/')) { triggerBody = route.request().postDataJSON(); return json({ ok: true, message: 'Виконано.', sheetUrl: 'https://docs.google.com/spreadsheets/d/report/edit' }); }
    if (['/', '/style.css', '/app.js'].includes(pathname)) {
      return route.fulfill({ body: await fs.readFile(`public/${pathname === '/' ? 'index.html' : pathname.slice(1)}`),
        contentType: pathname === '/' ? 'text/html; charset=utf-8' : pathname.endsWith('css') ? 'text/css' : 'application/javascript' });
    }
    return route.fulfill({ status: 404 });
  });
  try {
    await page.goto('http://bird.test');
    await page.getByRole('link', { name: 'Увійти через Google' }).waitFor();
    signedIn = true;
    await page.reload();
    await page.locator('#course-options option').first().waitFor({ state: 'attached' });
    assert.equal(await page.locator('[name="ASSIGNMENT_NAME"]').inputValue(), 'Інформація про науково-дослідну роботу');
    assert.equal(await page.locator('[name="HEAD_OF_DEPT_EMAIL"]').inputValue(), 'user@example.com');
    assert.equal(await page.locator('[name="STATIC_PLAN_SHEET_ID"], [name="MASTER_OUTPUT_FOLDER_ID"], #course-select').count(), 0, 'no hardcoded resource fields');
    assert.match(await page.locator('#workspace-help').textContent() || '', /Секретар кафедри/);
    await page.locator('[name="COURSE_NAME"]').fill('інформатики');
    await page.locator('[name="HEAD_OF_DEPT_EMAIL"]').fill('head@example.com');
    await page.locator('[name="SCI_DEPT_EMAIL"]').fill('science@example.com');
    await page.getByRole('button', { name: 'Зберегти налаштування' }).click();
    await page.getByText('Іваненко Олена', { exact: false }).waitFor();
    assert.equal(settings!.COURSE_NAME, 'інформатики');
    assert.equal(settings!.HEAD_OF_DEPT_EMAIL, 'head@example.com');
    assert.match(await page.locator('#course-label').textContent() || '', /Кафедра інформатики/);
    assert.equal(await page.locator('#teachers tr').count(), 2);
    assert.equal(await page.locator('#submitted').textContent(), '1');
    assert.equal(await page.locator('#missing').textContent(), '1');
    await page.getByRole('button', { name: 'Створити чернетку й нагадати' }).click();
    await page.locator('#report-link').waitFor();
    assert.deepEqual(triggerBody, {});
    assert.equal(await page.getByText(/dry.?run/i).count(), 0);
    await fs.mkdir('tmp', { recursive: true });
    await page.screenshot({ path: 'tmp/dashboard-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
    assert.equal(await page.locator('#workspace-links a').count(), 4);
    assert.equal(await page.locator('#workspace-links a').first().getAttribute('href'), workspace.rootFolderUrl);
    await page.screenshot({ path: 'tmp/settings-desktop.png', fullPage: true });
    console.log('PASS: course by name, default assignment, auto-provisioned workspace links, report action');

    await page.getByRole('button', { name: 'Користувачі' }).click();
    await page.getByText('colleague@example.com', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Роль: user@example.com').isDisabled(), true, 'admins cannot change their own role');
    await page.getByLabel('Роль: colleague@example.com').selectOption('viewer');
    await page.getByText('Роль colleague@example.com: Перегляд.').waitFor();
    assert.deepEqual(roleChange, { role: 'viewer' });
    assert.match(await page.locator('#audit').textContent() || '', /Перегляд → Редактор/);
    await page.screenshot({ path: 'tmp/admin-desktop.png', fullPage: true });
    console.log('PASS: admin tab lists users, changes roles and shows the audit log');

    role = 'viewer';
    await page.reload();
    await page.getByText('Іваненко Олена', { exact: false }).waitFor();
    assert.equal(await page.locator('#readonly-note').isVisible(), true);
    assert.equal(await page.locator('#phase-actions').isVisible(), false);
    assert.equal(await page.locator('#admin-tab').isVisible(), false);
    assert.equal(await page.locator('#account-role').textContent(), 'Перегляд');
    await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
    assert.equal(await page.locator('[name="COURSE_NAME"]').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Зберегти налаштування' }).isDisabled(), true);
    console.log('PASS: viewer role is read-only');

    role = 'admin';
    await page.reload();
    await page.getByText('Іваненко Олена', { exact: false }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'tmp/dashboard-mobile.png', fullPage: true });
    for (const tab of ['Налаштування', 'Користувачі']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${tab} fits on mobile`);
    }
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: login, setup, report action, roles, Ukrainian text, desktop and mobile layouts');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
