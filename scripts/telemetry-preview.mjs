// Static Vite previews have no API. Accept browser beacons just as the
// production /api/t endpoint does, leaving telemetry collection enabled.
export const telemetryPreview = {
  name: 'telemetry-preview',
  configurePreviewServer(server) {
    server.middlewares.use('/api/t',(request,response,next)=>{
      if(request.method!=='POST')return next()
      request.resume()
      response.writeHead(204).end()
    })
  },
}
