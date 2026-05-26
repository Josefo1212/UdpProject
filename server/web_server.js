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

// [ ] Arquitectura del Servidor Web: Enlace a la carpeta del Integrante 3
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// [ ] Puente de Control (/api/videos): Traducción HTTP-UDP
app.get('/api/videos', (req, res) => {
  const udpClient = dgram.createSocket('udp4');
  const requestMsg = Buffer.from(JSON.stringify({ type: 'LIST' }));

  // Capturar la respuesta binaria
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
  
  // Enviar comando al Integrante 1
  udpClient.send(requestMsg, UDP_SERVER_PORT, UDP_HOST);
});

// Endpoint del Streaming (Orquestación, Tuberías y Limpieza)
app.get('/api/stream', (req, res) => {
  const videoName = req.query.video;
  if (!videoName) return res.status(400).send('Video no especificado');

  // Preparar cabeceras HTTP para streaming de video
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked'
  });

  const udpClient = dgram.createSocket('udp4');

  // [ ] Orquestación de FFmpeg vía child_process.spawn
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',             // Entrada: stdin
    '-c:v', 'libx264',          // Asegurar codec compatible con web
    '-preset', 'veryfast',      // Optimización web
    '-tune', 'zerolatency',     // Procesamiento en tiempo real
    '-f', 'mp4',                // Contenedor de salida
    '-movflags', 'frag_keyframe+empty_moov', // Fragmentación MP4 para streams
    'pipe:1'                    // Salida: stdout
  ]);

  // [ ] Tuberías de Datos (Pipeline): FFmpeg -> HTTP
  ffmpeg.stdout.on('data', (chunk) => {
    res.write(chunk); // Escribir en el stream de respuesta al navegador
  });

  // Tuberías de Datos: UDP -> FFmpeg
  udpClient.on('message', (msg) => {
    if (msg.toString() === 'EOF') {
      ffmpeg.stdin.end(); // Notificar a FFmpeg que no hay más datos
      udpClient.close();
    } else {
      ffmpeg.stdin.write(msg); // Inyectar fragmentos UDP crudos a FFmpeg
    }
  });

  // Solicitar el flujo de datos al Integrante 1
  const streamCommand = Buffer.from(JSON.stringify({ type: 'STREAM', video: videoName }));
  udpClient.send(streamCommand, UDP_SERVER_PORT, UDP_HOST);

  // [ ] Limpieza de Recursos y Conexiones Muertas
  req.on('close', () => {
    console.log(`[Proxy] Conexión cerrada. Limpiando subproceso de ${videoName}`);
    ffmpeg.kill('SIGKILL'); // Evitar hilos zombies
    try {
      udpClient.close(); // Evitar fugas en puertos UDP
    } catch (e) {}
  });
});

app.listen(HTTP_PORT, () => {
  console.log(`Proxy Web / Procesamiento multimedia escuchando en http://localhost:${HTTP_PORT}`);
});