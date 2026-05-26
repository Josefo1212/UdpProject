import dgram from 'dgram';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPTIONS = {
  port: 5001,
  host: '127.0.0.1',
  blockSize: 60 * 1024
};

const VIDEO_DIR = path.join(__dirname, 'videos');

if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

const server = dgram.createSocket('udp4');

server.on('listening', () => {
  const address = server.address();
  console.log(`UDP storage server listening on ${address.address}:${address.port}`);
});

server.on('message', (msg, rinfo) => {
  let request;
  try {
    request = JSON.parse(msg.toString().trim());
  } catch {
    console.error(`Invalid JSON control packet from ${rinfo.address}:${rinfo.port}`);
    return;
  }

  if (request.type === 'LIST') {
    try {
      const entries = fs.readdirSync(VIDEO_DIR, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
      const response = Buffer.from(JSON.stringify({ type: 'LIST', files }));
      server.send(response, rinfo.port, rinfo.address);
    } catch (err) {
      console.error(`Failed to list videos: ${err.message}`);
    }
    return;
  }

  if (request.type === 'STREAM') {
    const videoName = request.video;
    const resolvedDir = path.resolve(VIDEO_DIR) + path.sep;
    const resolvedPath = path.resolve(VIDEO_DIR, videoName || '');

    if (!resolvedPath.startsWith(resolvedDir) || !fs.existsSync(resolvedPath)) {
      console.error(`Denied or missing file: ${videoName}`);
      return;
    }

    const fileStream = fs.createReadStream(resolvedPath, {
      highWaterMark: OPTIONS.blockSize
    });

    fileStream.on('data', (chunk) => {
      fileStream.pause();

      server.send(chunk, rinfo.port, rinfo.address, (err) => {
        if (err) {
          console.error(`UDP send failed: ${err.message}`);
          fileStream.destroy();
          return;
        }
        // Pace UDP datagrams to avoid overwhelming downstream buffers.
        setTimeout(() => fileStream.resume(), 1);
      });
    });

    fileStream.on('end', () => {
      const eofPayload = Buffer.from('EOF');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        setTimeout(() => {
          server.send(eofPayload, rinfo.port, rinfo.address);
        }, attempt * 50);
      }
    });

    fileStream.on('error', (err) => {
      console.error(`Stream error: ${err.message}`);
      const eofPayload = Buffer.from('EOF');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        setTimeout(() => {
          server.send(eofPayload, rinfo.port, rinfo.address);
        }, attempt * 50);
      }
    });
  }
});

server.on('error', (err) => {
  console.error(`Socket error:\n${err.stack}`);
  if (err.code === 'EADDRINUSE') {
    server.close();
  }
});

server.bind(OPTIONS.port, OPTIONS.host);
