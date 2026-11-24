/** Traverse the model with the same controller used in normal walk mode. */
export async function stationWalk(page) {
  const result = await page.evaluate(async () => {
    const { walk, stream } = window.viewer
    const exit = [-2169.15, 1738.87]
    const platform = [-2257.34, 1750.49]
    const route = [
      [-2200.65, 1741.55],
      [-2221.35, 1744.68],
      platform,
      [-2221.35, 1744.68],
      [-2200.65, 1741.55],
      exit,
      [-2161.5, 1739.76],
      [-2143.95, 1768.37],
      [-2126.4, 1780.44],
      [-2103, 1801.9],
      [-2085, 1802.79],
      [-2079, 1802.9],
    ]
    walk.leave()
    if (!(await walk.enter(...exit, 0, 'station')))
      throw Error('Station spawn failed')
    const timeout = performance.now() + 45000
    while (
      ![...stream.landmarks.keys()].some((lm) => lm.id === 'guilin_station')
    ) {
      if (performance.now() > timeout)
        throw Error('Station collider did not load')
      await new Promise(requestAnimationFrame)
    }
    await window.viewer.freeze()
    try {
      for (const target of route) {
        let remaining = Infinity
        for (let frame = 0; frame < 2400; frame++) {
          const p = walk.probe()
          const dx = target[0] - p.x,
            dz = target[1] - p.z
          remaining = Math.hypot(dx, dz)
          if (remaining < 0.6) break
          if (p.resets || p.inHouse || p.inPeak)
            throw Error('Invalid station walk ' + JSON.stringify(p))
          walk.drive(dx / remaining, dz / remaining, true)
          walk.tick(1 / 30)
          stream.tick(walk.position)
          if (frame % 60 === 0) await new Promise((r) => setTimeout(r, 0))
        }
        if (remaining >= 0.6)
          throw Error(
            'Station route stopped ' +
              JSON.stringify({ target, remaining, probe: walk.probe() }),
          )
        if (target === platform) {
          // Probe the simulated track boundary from the accessible platform.
          const rail = [-2260.98, 1750.92]
          for (let frame = 0; frame < 90; frame++) {
            const {x, z} = walk.probe()
            const dx = rail[0] - x, dz = rail[1] - z
            const distance = Math.hypot(dx, dz)
            if (distance < 1.5) throw Error('Walker entered station track bed')
            walk.drive(dx / distance, dz / distance, true)
            walk.tick(1 / 30)
          }
        }
      }
      return walk.probe()
    } finally {
      walk.drive(0, 0, false)
      window.viewer.resume()
    }
  })
  console.log('桂林站出站口、站台、广场、中山南路', result.x, result.z)
}
