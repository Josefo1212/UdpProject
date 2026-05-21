import dgram from 'dgram'
import fs from 'fs/promises'

const options = {
  port:'5001',
  host:'localhost',
  blockSize: 60 * 1024
}

const server = dgram.createSocket('udp4')

server.on('listening', () => {
  const address = server.address()
  console.log(`UDP Server listening on ${address.address}:${address.port}`)
})

server.on('message', async (msg, rinfo) => {
  console.log(`Received message from ${rinfo.address}:${rinfo.port}`)
  const fileName = msg.toString().trim()
})

server.on('error', (err) => {
  console.error(`UDP Server error:\n${err.stack}`)
  server.close()
})

server.bind(options.port, options.host)