export async function enableStickInput(page, touch) {
  const session = touch && await page.context().newCDPSession(page)
  await page.exposeFunction('testStick', async (phase, x, y) => {
    if (touch) {
      const type = {down: 'touchStart', move: 'touchMove', up: 'touchEnd'}[phase]
      await session.send('Input.dispatchTouchEvent', {type, touchPoints: phase === 'up' ? [] : [{x, y}]})
    } else if (phase === 'up') await page.mouse.up()
    else {
      await page.mouse.move(x, y)
      if (phase === 'down') await page.mouse.down()
    }
  })
}
