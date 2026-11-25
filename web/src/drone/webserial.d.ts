// IDOK-281: minimal Web Serial type surface (only what the DJI RC driver needs).
// Not pulling @types/w3c-web-serial — keep the dep tree lean.

interface SerialOptions {
  baudRate:number
  bufferSize?:number
}

interface SerialSignals {
  dataTerminalReady?:boolean
  requestToSend?:boolean
}

interface SerialPortInfoLike {
  usbVendorId?:number
  usbProductId?:number
}

interface SerialPortLike {
  open(options:SerialOptions):Promise<void>
  close():Promise<void>
  setSignals(signals:SerialSignals):Promise<void>
  getInfo():SerialPortInfoLike
  readonly readable:ReadableStream<Uint8Array>|null
  readonly writable:WritableStream<Uint8Array>|null
}

interface ReadableStream<T> {
  getReader():ReadableStreamDefaultReader<T>
}

interface WritableStream<T> {
  getWriter():WritableStreamDefaultWriter<T>
}

interface Serial {
  requestPort(options?:{filters?:Array<{usbVendorId:number}>}):Promise<SerialPortLike>
  getPorts():Promise<SerialPortLike[]>
}

interface Navigator {
  serial?:Serial
}
