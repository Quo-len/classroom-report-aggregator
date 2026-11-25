import assert from 'assert/strict';
import fs from 'fs/promises';
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let signedIn = false;
  let settings: Record<string, string> | null = null;
  let triggerBody: unknown;
  const fields = {
    CLASSROOM_COURSE_ID: 'course-1', ASSIGNMENT_NAME: 'Інформація про науково-дослідну роботу',
    STATIC_PLAN_SHEET_ID: 'plan', STATIC_SCI_PLAN_SHEET_ID: 'science', MASTER_OUTPUT_FOLDER_ID: 'folder',
    HEAD_OF_DEPT_EMAIL: 'head@example.com', SCI_DEPT_EMAIL: 'science@example.com', HEAD_OF_DEPT_CHAT_ID: '',
  };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://bird.test') { await route.abort(); return; }
    const pathname = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (pathname === '/api/me') return json({ user: signedIn ? { email: 'user@example.com', connected: true } : null, settings, csrfToken: 'test-csrf' });
    if (pathname === '/api/courses') return json({ courses: [{ id: 'course-1', name: 'Кафедра інформатики' }] });
    if (pathname === '/api/settings') {
      assert.equal(route.request().headers()['x-csrf-token'], 'test-csrf');
      settings = route.request().postDataJSON().settings;
      return json({ ok: true });
    }
    if (pathname === '/api/status') return json({
      assignment: { title: fields.ASSIGNMENT_NAME, creationDate: '20 листопада 2026', deadline: '28 листопада 2026', daysRemaining: 3 },
      teachers: [
        { name: 'Іваненко Олена', email: 'olena@example.com', hasSubmitted: true, attachments: ['Науковий звіт.docx'] },
        { name: 'Петренко Андрій', email: 'andrii@example.com', hasSubmitted: false, attachments: [] },
      ],
    });
    if (pathname === '/api/runs') return json({ runs: triggerBody ? [{
      phase: 'draft', status: 'completed', started_at: '2026-11-25T09:00:00Z',
      sheet_url: 'https://docs.google.com/spreadsheets/d/report/edit',
    }] : [] });
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
    await page.locator('#course-select option[value="course-1"]').waitFor({ state: 'attached' });
    for (const [name, value] of Object.entries(fields)) {
      if (name === 'CLASSROOM_COURSE_ID') await page.locator(`[name="${name}"]`).selectOption(value);
      else await page.locator(`[name="${name}"]`).fill(value);
    }
    await page.locator('[name="STATIC_PLAN_SHEET_ID"]').fill('https://docs.google.com/spreadsheets/d/plan/edit');
    await page.getByRole('button', { name: 'Зберегти налаштування' }).click();
    await page.getByText('Іваненко Олена', { exact: false }).waitFor();
    assert.equal((settings as Record<string, string> | null)?.STATIC_PLAN_SHEET_ID, 'plan');
    assert.equal(await page.locator('#teachers tr').count(), 2);
    assert.equal(await page.locator('#submitted').textContent(), '1');
    assert.equal(await page.locator('#missing').textContent(), '1');
    await page.getByRole('button', { name: 'Створити чернетку й нагадати' }).click();
    await page.locator('#report-link').waitFor();
    assert.deepEqual(triggerBody, {});
    assert.equal(await page.getByText(/dry.?run/i).count(), 0);
    await fs.mkdir('tmp', { recursive: true });
    await page.screenshot({ path: 'tmp/dashboard-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'tmp/dashboard-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
    await page.locator('#settings-form').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: login, setup, report action, Ukrainian text, desktop and mobile layouts');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
