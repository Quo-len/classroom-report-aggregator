import assert from 'assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { accountContext } from '../src/core/account-context';
import { AuthService } from '../src/services/auth.service';
import { NotifyService } from '../src/services/notify.service';
import { env } from '../src/config/env';

async function main() {
  await Promise.all(['alice', 'bob'].map((userId, index) => {
    const auth = new OAuth2Client();
    return accountContext.run({ userId, auth, settings: { CLASSROOM_COURSE_ID: userId }, dryRun: index === 0 }, async () => {
      await new Promise(resolve => setTimeout(resolve, 10 - index));
      assert.equal(await AuthService.getAuthClient(), auth);
      assert.equal(env.CLASSROOM_COURSE_ID, userId);
      assert.equal(NotifyService.dryRun, index === 0);
      assert.equal(env.HEAD_OF_DEPT_EMAIL, undefined);
    });
  }));
  assert.equal(accountContext.getStore(), undefined);
  console.log('Concurrent account isolation passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
