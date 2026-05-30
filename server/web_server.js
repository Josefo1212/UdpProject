import express from 'express';
import dgram from 'dgram';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const HTTP_PORT = 3000;
const UDP_SERVER_PORT = 5001;
const UDP_HOST = '127.0.0.1';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Permite cualquier origen
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

app.get('/api/videos', (req, res) => {
  const udpClient = dgram.createSocket('udp4');
  const requestMsg = Buffer.from(JSON.stringify({ type: 'LIST' }));

  udpClient.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      res.json(data); // Devolver al navegador en JSON limpio
    } catch (err) {
      res.status(500).json({ error: 'Error decodificando respuesta UDP' });
    } finally {
      udpClient.close(); // Cerrar el cliente temporal
    }
  });

  udpClient.on('error', () => udpClient.close());
  
  udpClient.send(requestMsg, UDP_SERVER_PORT, UDP_HOST);
});

// Endpoint del Streaming (Orquestación, Tuberías y Limpieza)
app.get('/api/stream', (req, res) => {
  const videoName = req.query.video;
  if (!videoName) return res.status(400).send('Video no especificado');

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked'
  });

  const udpClient = dgram.createSocket('udp4');
  let lastUdpAt = Date.now();
  let watchdogId = null;

  const cleanup = () => {
    if (watchdogId) {
      clearInterval(watchdogId);
      watchdogId = null;
    }
    try {
      udpClient.close();
    } catch (e) {}
  };

  const endResponse = () => {
    if (!res.writableEnded) {
      res.end();
    }
    cleanup();
  };

  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',             // Entrada: stdin
    '-c:v', 'libx264',          // Asegurar codec compatible con web
    '-preset', 'veryfast',      // Optimización web
    '-tune', 'zerolatency',     // Procesamiento en tiempo real
    '-f', 'mp4',                // Contenedor de salida
    '-movflags', 'frag_keyframe+empty_moov', // Fragmentación MP4 para streams
    'pipe:1'                    // Salida: stdout
  ]);

  ffmpeg.stdout.on('data', (chunk) => {
    res.write(chunk); // Escribir en el stream de respuesta al navegador
  });

  ffmpeg.on('error', (err) => {
    console.error(`[Proxy] FFmpeg no pudo iniciarse: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).send('FFmpeg no disponible en el servidor');
    } else {
      res.end();
    }
    cleanup();
  });

  ffmpeg.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) {
      console.error(`[FFmpeg] ${message}`);
    }
  });

  ffmpeg.on('close', (code) => {
    endResponse();
    if (code !== 0) {
      console.error(`[Proxy] FFmpeg cerró con código ${code}`);
    }
  });

  udpClient.on('message', (msg) => {
    lastUdpAt = Date.now();
    if (msg.toString() === 'EOF') {
      ffmpeg.stdin.end(); // Notificar a FFmpeg que no hay más datos
      cleanup();
    } else {
      ffmpeg.stdin.write(msg); // Inyectar fragmentos UDP crudos a FFmpeg
    }
  });

  watchdogId = setInterval(() => {
    if (Date.now() - lastUdpAt > 5000) {
      console.error('[Proxy] Timeout esperando datos UDP');
      ffmpeg.stdin.end();
      endResponse();
    }
  }, 1000);

  const streamCommand = Buffer.from(JSON.stringify({ type: 'STREAM', video: videoName }));
  udpClient.send(streamCommand, UDP_SERVER_PORT, UDP_HOST);

  req.on('close', () => {
    console.log(`[Proxy] Conexión cerrada. Limpiando subproceso de ${videoName}`);
    ffmpeg.kill('SIGKILL'); // Evitar hilos zombies
    cleanup();
  });
});

app.listen(HTTP_PORT, () => {
  console.log(`Proxy Web / Procesamiento multimedia escuchando en http://localhost:${HTTP_PORT}`);
});