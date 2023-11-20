import net from 'node:net'
import tls from 'node:tls'
import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'
import EventEmitter from 'node:events'
import { URL } from 'node:url'

function parseHeaders(data) {
  let payloadStartIndex = 2

  const opcode = data[0] & 0b00001111
  const fin = (data[0] & 0b10000000) == 0b10000000

  // Line below is experimental, if it doesn't work, comment it.
  if (opcode == 0x0) payloadStartIndex += 2

  let payloadLength = data[1] & 0b01111111

  if (payloadLength == 126) {
    payloadStartIndex += 2
    payloadLength = data.readUInt16BE(2)
  } else if (payloadLength == 127) {
    payloadStartIndex += 8
    payloadLength = data.readBigUInt64BE(2)
  }

  return {
    opcode,
    fin,
    payload: data,
    payloadLength,
    payloadStartIndex
  }
}

class WebSocket extends EventEmitter {
  constructor(url, options) {
    super()

    this.url = url
    this.options = options
    this.socket = null
    this.cachedData = []

    this.connect()

    return this
  }

  connect() {
    const parsedUrl = new URL(this.url)
    const isSecure = parsedUrl.protocol == 'wss:'
    const agent = isSecure ? https : http
    const key = crypto.randomBytes(16).toString('base64')

    const request = agent.request((isSecure ? 'https://' : 'http://') + parsedUrl.hostname + parsedUrl.pathname, {
      port: parsedUrl.port || (isSecure ? 443 : 80),
      timeout: this.options.timeout || 0,
      createConnection: (options) => {
        if (isSecure) {
          options.path = undefined

          if (!options.servername && options.servername != '')
            options.servername = net.isIP(options.host) ? '' : options.host

          return tls.connect(options)
        } else {
          options.path = options.socketPath

          return net.connect(options)
        }
      },
      headers: {
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': 13,
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        ...(this.options.headers || {})
      },
      method: 'GET'
    })

    request.on('error', (err) => {
      this.emit('error', err)
      this.emit('close')
    })

    request.on('upgrade', (res, socket, head) => {
      socket.setNoDelay()
      socket.setKeepAlive(true)

      if (head.length != 0) socket.unshift(head)

      if (res.headers.upgrade.toLowerCase() != 'websocket') {
        socket.destroy()

        return;
      }
  
      const digest = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')
  
      if (res.headers['sec-websocket-accept'] != digest) {
        socket.destroy()

        return;
      }

      socket.on('data', (data) => {
        const headers = parseHeaders(data)

        switch (headers.opcode) {
          case 0x0: {
            this.cachedData.push(data.subarray(headers.payloadStartIndex).subarray(0, headers.payloadLength))
  
            if (headers.fin) {
              const parsedData = Buffer.concat(this.cachedData)
  
              this.emit('message', parsedData.toString())
  
              this.cachedData = []
            }
  
            break
          }
          case 0x1: {
            const parsedData = data.subarray(headers.payloadStartIndex).subarray(0, headers.payloadLength)
  
            this.emit('message', parsedData.toString())
  
            break
          }
          case 0x2: {
            throw new Error('Binary data is not supported.')
  
            break
          }
          case 0x8: {
            this.emit('close')
  
            break
          }
          case 0x9: {
            const pong = Buffer.allocUnsafe(2)
            pong[0] = 0x8a
            pong[1] = 0x00
  
            this.socket.write(pong)
  
            break
          }
          case 0x10: {
            this.emit('pong')
          }
        }
  
        if (data.length > headers.payloadStartIndex + headers.payloadLength)
          this.socket.unshift(data.subarray(headers.payloadStartIndex + headers.payloadLength))
      })
  
      socket.on('close', () => this.emit('close'))

      this.socket = socket

      this.emit('open', socket, res.headers)
    })

    request.end()
  }

  sendFrame(data, options) {
    let startIndex = 2

    if (options.len >= 65536) {
      startIndex += 8
      options.len = 127
    } else if (options.len > 125) {
      startIndex += 2
      options.len = 126
    }

    const header = Buffer.allocUnsafe(startIndex)
    header[0] = options.fin ? options.opcode | 0x80 : options.opcode
    header[1] = options.len

    if (options.len == 126) {
      header.writeUInt16BE(options.len, 2)
    } else if (options.len == 127) {
      header[2] = header[3] = 0
      header.writeUIntBE(options.len, 4, 6)
    }

    if (!this.socket.write(Buffer.concat([header, data]))) {
      this.socket.end()

      return false
    }

    return true
  }

  close(code, reason) {
    const data = Buffer.allocUnsafe(2 + Buffer.byteLength(reason || 'normal close'))
    data.writeUInt16BE(code || 1000)
    data.write(reason || 'normal close', 2)

    this.sendFrame(data, { len: data.length, fin: true, opcode: 0x08 })

    return true
  }
}

export default WebSocket