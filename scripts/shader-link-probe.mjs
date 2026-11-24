// Diagnostic runs only: page.addInitScript(shaderLinkProbe), then read window.shaderLinkSamples.
export function shaderLinkProbe(){
  const gl=WebGL2RenderingContext.prototype,labels=new WeakMap(),programs=new WeakMap()
  const samples=window.shaderLinkSamples=[]
  const shaderSource=gl.shaderSource,attachShader=gl.attachShader
  gl.shaderSource=function(shader,source){
    labels.set(shader,source.match(/^#define SHADER_TYPE (\S+)/m)?.[1]??'custom')
    return shaderSource.call(this,shader,source)
  }
  gl.attachShader=function(program,shader){
    if(!programs.has(program)){
      const row={id:samples.length,type:labels.get(shader),calls:{}}
      programs.set(program,row);samples.push(row)
    }
    return attachShader.call(this,program,shader)
  }
  for(const method of ['linkProgram','getProgramInfoLog','getProgramParameter','getAttribLocation','getUniformLocation','useProgram']){
    const original=gl[method]
    gl[method]=function(program,...args){
      const row=programs.get(program),key=method==='getProgramParameter'?`${method}:${args[0]}`:method
      if(!row||key==='getProgramParameter:37297'||row.calls[key])return original.call(this,program,...args)
      const start=performance.now(),result=original.call(this,program,...args)
      row.calls[key]={start,ms:performance.now()-start}
      return result
    }
  }
}
