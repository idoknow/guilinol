export function glHookScript() {
  const buffers = new Map()
  const textures = new Map()
  const renderbuffers = new Map()
  const boundBuf = new Map()
  const boundTex = new Map()
  let unit = 0x84c0
  let boundRbo = null
  let boundFbo = null
  const frame = {calls: 0, triangles: 0, mirrorCalls: 0, mirrorTriangles: 0, lines: 0}

  function bytesPerPixel(internalFormat, type) {
    // HALF_FLOAT = 0x140B, FLOAT = 0x1406, RGBA16F = 0x881A, RGBA32F = 0x8814
    if (internalFormat === 0x8814 || type === 0x1406) return 16
    if (internalFormat === 0x881a || type === 0x140b) return 8
    // KTX2 transcodes used by the viewer (4x4 blocks). Other texture formats
    // retain the RGBA8 estimate; driver alignment is outside WebGL accounting.
    if ([33776,33777,35916,35917,36196,37492,37493].includes(internalFormat)) return .5
    if ([33778,33779,35918,35919,37496,37497,36492,36493,37808,37840].includes(internalFormat)) return 1
    return 4
  }

  function patchProto(Proto) {
    if (!Proto || Proto.__perfPatched) return
    Proto.__perfPatched = true

    const origCreateBuffer = Proto.createBuffer
    Proto.createBuffer = function (...args) {
      const b = origCreateBuffer.apply(this, args)
      if (b) buffers.set(b, 0)
      return b
    }
    const origBindBuffer = Proto.bindBuffer
    Proto.bindBuffer = function (target, buffer) {
      boundBuf.set(target, buffer)
      return origBindBuffer.call(this, target, buffer)
    }
    const origBufferData = Proto.bufferData
    Proto.bufferData = function (target, srcOrSize, usage, srcOffset, length) {
      const b = boundBuf.get(target)
      if (b) {
        let size = 0
        if (typeof srcOrSize === 'number') size = srcOrSize
        else if (srcOrSize) {
          if (typeof length === 'number' && length > 0) size = length * (srcOrSize.BYTES_PER_ELEMENT || 1)
          else size = srcOrSize.byteLength ?? 0
        }
        buffers.set(b, size)
      }
      return origBufferData.apply(this, arguments)
    }
    const origDeleteBuffer = Proto.deleteBuffer
    Proto.deleteBuffer = function (b) {
      buffers.delete(b)
      return origDeleteBuffer.call(this, b)
    }

    const origCreateTexture = Proto.createTexture
    Proto.createTexture = function (...args) {
      const t = origCreateTexture.apply(this, args)
      if (t) textures.set(t, {w: 0, h: 0, bpp: 4, mips: false, bytes: 0})
      return t
    }
    const activeTexture = Proto.activeTexture
    Proto.activeTexture = function (slot) {
      unit = slot
      return activeTexture.call(this, slot)
    }
    const origBindTexture = Proto.bindTexture
    Proto.bindTexture = function (target, tex) {
      boundTex.set(unit*65536+target, textures.get(tex))
      return origBindTexture.call(this, target, tex)
    }
    const origTexImage2D = Proto.texImage2D
    Proto.texImage2D = function (target, level, internalformat, ...rest) {
      const t = boundTex.get(unit*65536+target)
      if (t && level === 0) {
        let w = 0, h = 0, type = 0x1401
        if (rest.length >= 5) {
          w = rest[0]; h = rest[1]; type = rest[4]
        } else if (rest[2]) {
          const src = rest[2]
          w = src.width || src.videoWidth || 0
          h = src.height || src.videoHeight || 0
          type = rest[1]
        }
        const bpp = bytesPerPixel(internalformat, type)
        t.w = w; t.h = h; t.bpp = bpp
        t.bytes = Math.round(w * h * bpp * (t.mips ? 4 / 3 : 1))
      }
      return origTexImage2D.apply(this, arguments)
    }
    const origTexStorage2D = Proto.texStorage2D
    if (origTexStorage2D) {
      Proto.texStorage2D = function (target, levels, internalformat, width, height) {
        const t = boundTex.get(unit*65536+target)
        if (t) {
          const bpp = bytesPerPixel(internalformat, 0)
          t.w = width; t.h = height; t.bpp = bpp; t.mips = levels > 1
          t.bytes = Math.round(width * height * bpp * (levels > 1 ? 4 / 3 : 1))
        }
        return origTexStorage2D.apply(this, arguments)
      }
    }
    const origCompressedTexImage2D = Proto.compressedTexImage2D
    Proto.compressedTexImage2D = function (target, level, internalformat, width, height, border, data) {
      const t = boundTex.get(unit*65536+target)
      if (t) {
        const add = data?.byteLength ?? 0
        t.bytes = (level === 0 ? 0 : t.bytes) + add
      }
      return origCompressedTexImage2D.apply(this, arguments)
    }
    const origGenerateMipmap = Proto.generateMipmap
    Proto.generateMipmap = function (target) {
      const t = boundTex.get(unit*65536+target)
      if (t && !t.mips) {
        t.mips = true
        t.bytes = Math.round(t.w * t.h * t.bpp * (4 / 3))
      }
      return origGenerateMipmap.call(this, target)
    }
    const origDeleteTexture = Proto.deleteTexture
    Proto.deleteTexture = function (t) {
      textures.delete(t)
      return origDeleteTexture.call(this, t)
    }

    const origCreateRenderbuffer = Proto.createRenderbuffer
    Proto.createRenderbuffer = function (...args) {
      const r = origCreateRenderbuffer.apply(this, args)
      if (r) renderbuffers.set(r, 0)
      return r
    }
    const origBindRenderbuffer = Proto.bindRenderbuffer
    Proto.bindRenderbuffer = function (target, rbo) {
      boundRbo = rbo
      return origBindRenderbuffer.call(this, target, rbo)
    }
    const origRboStorage = Proto.renderbufferStorage
    Proto.renderbufferStorage = function (target, internalformat, width, height) {
      if (boundRbo) renderbuffers.set(boundRbo, width * height * 4)
      return origRboStorage.apply(this, arguments)
    }
    const origRboStorageMs = Proto.renderbufferStorageMultisample
    if (origRboStorageMs) {
      Proto.renderbufferStorageMultisample = function (target, samples, internalformat, width, height) {
        if (boundRbo) renderbuffers.set(boundRbo, width * height * 4 * Math.max(1, samples))
        return origRboStorageMs.apply(this, arguments)
      }
    }
    const origDeleteRbo = Proto.deleteRenderbuffer
    Proto.deleteRenderbuffer = function (r) {
      renderbuffers.delete(r)
      return origDeleteRbo.call(this, r)
    }

    const origBindFbo = Proto.bindFramebuffer
    Proto.bindFramebuffer = function (target, fbo) {
      if (target === 0x8d40 || target === 0x8ca9) boundFbo = fbo
      return origBindFbo.call(this, target, fbo)
    }

    function countPrims(mode, count, instances) {
      // TRIANGLES=4, TRIANGLE_STRIP=5, TRIANGLE_FAN=6, LINES=1
      let tris = 0
      if (mode === 4) tris = Math.floor(count / 3) * instances
      else if (mode === 5 || mode === 6) tris = Math.max(0, count - 2) * instances
      else if (mode === 1) frame.lines += Math.floor(count / 2) * instances
      if (boundFbo === null) {
        frame.calls += 1
        frame.triangles += tris
      } else {
        frame.mirrorCalls += 1
        frame.mirrorTriangles += tris
      }
    }

    const origDrawElements = Proto.drawElements
    Proto.drawElements = function (mode, count, type, offset) {
      countPrims(mode, count, 1)
      return origDrawElements.call(this, mode, count, type, offset)
    }
    const origDrawArrays = Proto.drawArrays
    Proto.drawArrays = function (mode, first, count) {
      countPrims(mode, count, 1)
      return origDrawArrays.call(this, mode, first, count)
    }
    const origDrawElementsInstanced = Proto.drawElementsInstanced
    if (origDrawElementsInstanced) {
      Proto.drawElementsInstanced = function (mode, count, type, offset, primcount) {
        countPrims(mode, count, primcount)
        return origDrawElementsInstanced.call(this, mode, count, type, offset, primcount)
      }
    }
    const origDrawArraysInstanced = Proto.drawArraysInstanced
    if (origDrawArraysInstanced) {
      Proto.drawArraysInstanced = function (mode, first, count, primcount) {
        countPrims(mode, count, primcount)
        return origDrawArraysInstanced.call(this, mode, first, count, primcount)
      }
    }
  }

  if (typeof WebGL2RenderingContext !== 'undefined') patchProto(WebGL2RenderingContext.prototype)
  if (typeof WebGLRenderingContext !== 'undefined') patchProto(WebGLRenderingContext.prototype)

  window.__glPerf = {
    resetFrame() {
      frame.calls = 0; frame.triangles = 0; frame.mirrorCalls = 0; frame.mirrorTriangles = 0; frame.lines = 0
    },
    readFrame() {
      return {...frame, totalCalls: frame.calls + frame.mirrorCalls, totalTriangles: frame.triangles + frame.mirrorTriangles}
    },
    memory() {
      let bufferBytes = 0, textureBytes = 0, renderbufferBytes = 0
      for (const sz of buffers.values()) bufferBytes += sz
      for (const t of textures.values()) textureBytes += t.bytes
      for (const sz of renderbuffers.values()) renderbufferBytes += sz
      const totalBytes = bufferBytes + textureBytes + renderbufferBytes
      return {
        buffers: buffers.size,
        textures: textures.size,
        bufferMB: +(bufferBytes / 1048576).toFixed(2),
        textureOnlyMB: +(textureBytes / 1048576).toFixed(2),
        textureMB: +((textureBytes + renderbufferBytes) / 1048576).toFixed(2),
        vramMB: +(totalBytes / 1048576).toFixed(2),
        totalBytes,
      }
    },
  }
}
