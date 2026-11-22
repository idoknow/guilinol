import assert from 'node:assert/strict'
import {mkdir, readFile, readdir} from 'node:fs/promises'
import {DatabaseSync} from 'node:sqlite'
import {timingSafeEqual, createHash} from 'node:crypto'
import {onRequest} from '../functions/api/[[path]].ts'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const output = 'captures/creator'
await mkdir(output, {recursive: true})
// Exercise the Pages handler against the real SQLite migrations in a disposable database.
const sql = new DatabaseSync(':memory:')
for (const file of (await readdir('migrations')).sort()) sql.exec(await readFile('migrations/' + file, 'utf8'))
function statement(query, args = []) {
  const prepared = sql.prepare(query)
  return {
    bind: (...values) => statement(query, values),
    first: () => prepared.get(...args) ?? null,
    run: () => ({meta: {changes: prepared.run(...args).changes}}),
  }
}
const DB = {
  prepare: statement,
  batch(statements) {
    sql.exec('BEGIN')
    try {
      const results = statements.map((s) => s.run())
      sql.exec('COMMIT')
      return results
    } catch (error) {
      sql.exec('ROLLBACK')
      throw error
    }
  },
}
crypto.subtle.timingSafeEqual = (a, b) => a.byteLength === b.byteLength && timingSafeEqual(a, b)
const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const origin = 'http://127.0.0.1:' + server.httpServer.address().port
let browser
try {
  browser = await chromium.launch(browserOptions(true))
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ]) {
    const context = await browser.newContext({viewport: {width, height}, hasTouch: width < 400})
    const page = await context.newPage(),
      errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const user = {email: 'creator-' + width + '@example.invalid', nickname: '桂林漫游者'}
    await page.route('**/api/**', async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname
      if (path === '/api/t') return route.fulfill({status: 204})
      const response = await onRequest({
        env: {DB, EMAIL_DEV_LOG: '1'},
        request: new Request(req.url(), {
          method: req.method(),
          headers: await req.allHeaders(),
          body: req.postData() ?? undefined,
        }),
      })
      if (path === '/api/auth/register' && response.ok) {
        // The mailbox is mocked. The normal verification endpoint checks the code, password and session.
        const digest = createHash('sha256')
          .update(user.email + ':verify:123456')
          .digest('hex')
        sql.prepare('UPDATE email_codes SET digest=? WHERE email=?').run(digest, user.email)
      }
      return route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      })
    })
    await page.goto(origin)
    await page.click('[data-umami-event=home-solo]')
    await page.click('button[data-to=register]')
    await page.fill('input[name=email]', user.email)
    await page.fill('input[name=password]', 'test-password-123')
    await page.fill('input[name=nickname]', user.nickname)
    await page.click('.acc-submit')
    await page.fill('input[name=code]', '123456')
    await page.click('.acc-submit')
    const creator = page.locator('dialog.creator'),
      click = (name) => creator.getByRole('button', {name, exact: true}).click()
    for (const [index, choice] of ['女', '小麦', '高马尾', '新中式', null].entries()) {
      if (choice) await click(choice)
      if (index === 2) await click('栗棕')
      await page.waitForTimeout(650)
      await page.screenshot({path: output + '/' + width + '-step-' + (index + 1) + '.png'})
      await click(index === 4 ? '进入桂林' : '下一步')
    }
    await page.waitForSelector('body[data-mode=walk]', {timeout: 90000})
    const {payload_json} = sql
      .prepare('SELECT payload_json FROM player_saves JOIN users ON users.id=user_id WHERE email=?')
      .get(user.email)
    const stored = JSON.parse(payload_json),
      saved = stored['glol.avatar.v1']
    assert.equal(stored.wardrobe.equipped.bottom, 'bottom_starter_chinese')
    assert(stored.wardrobe.ownedPresetIds.includes('starter_chinese'))
    assert.equal(saved.hair, 'f_pony')
    assert.equal(saved.skin, 3)
    assert.equal(saved.look, 'chinese')
    await page.locator('.creator-arrival').waitFor({state: 'detached'})
    await page.screenshot({path: output + '/' + width + '-spawn.png'})
    // Clear browser data to prove the second session restores from the cloud avatar.
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.click('[data-umami-event=home-solo]')
    await page.waitForSelector('body[data-mode=walk]', {timeout: 90000})
    assert.equal(await creator.count(), 0)
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('glol.avatar.v1'))), saved)
    if (width === 390) {
      await page.evaluate(() => window.dispatchEvent(new Event('game:open-wardrobe')))
      await page.click('.shop-edit-character')
    } else {
      await page.click('.account-entry')
      await page.getByRole('button', {name: '修改外形', exact: true}).click()
    }
    await click('男')
    await click('确认')
    await click('保存外形')
    await creator.waitFor({state: 'detached'})
    const edited = await page.evaluate(() => JSON.parse(localStorage.getItem('glol.avatar.v1')))
    assert.equal(edited.body, 'm')
    assert.equal(edited.hair, 'm_buzz')
    assert.equal(edited.createdAt, saved.createdAt)
    if(width===390){
      // A returning player with a legacy save must see creation even if this browser has a cached avatar.
      sql.prepare('UPDATE player_saves SET payload_json=? WHERE user_id=(SELECT id FROM users WHERE email=?)')
        .run(JSON.stringify({money:784,wardrobe:{ownedItemIds:['hat_karst_cap']}}),user.email)
      await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.click('[data-umami-event=home-solo]')
      await creator.locator('[data-random]').click();await click('重置');await click('跳过')
      await page.waitForSelector('body[data-mode=walk]',{timeout:90000})
      const legacy=JSON.parse(sql.prepare('SELECT payload_json FROM player_saves JOIN users ON users.id=user_id WHERE email=?').get(user.email).payload_json)
      assert.equal(legacy.money,784);assert(legacy.wardrobe.ownedItemIds.includes('hat_karst_cap'))
      assert.equal(legacy['glol.avatar.v1'].look,'basic')
    }
    assert.deepEqual(errors, [])
    await context.close()
    console.log(width + '×' + height + ' registration, verification, creation, spawn and cloud restore passed')
  }
} finally {
  await browser?.close()
  await server.close()
  sql.close()
}
