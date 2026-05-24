import dgram from 'dgram';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Emulación de __dirname requerida para entornos ES Modules..
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parámetros de configuración de la capa de transporte y aplicación
const OPTIONS = {
  port: 5001,
  host: '127.0.0.1',   // Uso de IP directa para evitar latencia por resolución DNS local
  blockSize: 60 * 1024 // 60KB por datagrama (Límite seguro para evitar fragmentación IP excesiva)
};

const VIDEO_DIR = path.join(__dirname, 'videos');

// Garantizar la existencia del directorio antes de indexar la memoria
if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

// ====================================================================
// SISTEMA DE CACHÉ REACTIVO EN MEMORIA RAM (DESACOPLAMIENTO ABSOLUTO)
// ====================================================================
let cachedVideos = [];

const updateVideoCache = () => {
  try {
    if (!fs.existsSync(VIDEO_DIR)) return;
    
    // Obtenemos las entradas del sistema con sus tipos nativos descriptor de archivo
    const entries = fs.readdirSync(VIDEO_DIR, { withFileTypes: true });
    
    // Filtramos ignorando subcarpetas, pero aceptando CUALQUIER formato o extensión de archivo
    cachedVideos = entries
      .filter(entry => entry.isFile())
      .map(entry => entry.name);
    
    console.log(`[CACHÉ] Sincronizado. Total en RAM: ${cachedVideos.length} archivos detectados.`);
  } catch (err) {
    console.error('[CACHÉ] Error crítico al indexar el directorio:', err.message);
  }
}

// 1. Carga e indexación inicial en el arranque del proceso
updateVideoCache();

// 2. File System Watcher: Actualiza la RAM automáticamente ante cualquier cambio físico en el disco
fs.watch(VIDEO_DIR, (eventType, filename) => {
  if (filename) {
    console.log(`[WATCHER] Modificación detectada en el almacenamiento: ${filename} -> Evento: ${eventType}`);
    updateVideoCache();
  }
});

// ====================================================================
// CONTROLADOR DE PROTOCOLOS DE RED Y SOCKETS DE BAJO NIVEL
// ====================================================================
const server = dgram.createSocket('udp4');

// Evento de inicialización exitosa del socket
server.on('listening', () => {
  const address = server.address();
  console.log(`🚀 Servidor UDP de Almacenamiento Operacional en ${address.address}:${address.port}`);
});

// Evento principal: Recepción y enrutamiento de datagramas de control
server.on('message', async (msg, rinfo) => {
  try {
    // Decodificación del protocolo de control basado en tramas JSON
    const request = JSON.parse(msg.toString().trim());

    // COMANDO 1: Solicitud de catálogo (Rendimiento O(1) directo desde RAM, Disk I/O = 0)
    if (request.type === 'LIST') {
      const response = Buffer.from(JSON.stringify({ type: 'LIST', files: cachedVideos }));
      server.send(response, rinfo.port, rinfo.address);
      console.log(`[UDP] Catálogo enviado a ${rinfo.address}:${rinfo.port}`);
    } 
    
    // COMANDO 2: Transmisión de flujo binario (Streaming con control de flujo)
    else if (request.type === 'STREAM') {
      const videoName = request.video;
      const filePath = path.join(VIDEO_DIR, videoName);

      // Regla de Seguridad Obligatoria: Previene ataques de inyección de rutas (Path Traversal)
      if (!filePath.startsWith(VIDEO_DIR) || !fs.existsSync(filePath)) {
        console.error(`[UDP] Acceso denegado o recurso inexistente: ${videoName}`);
        return;
      }

      console.log(`[UDP] Inicializando pipeline de transmisión para: ${videoName} -> Puerto Destino: ${rinfo.port}`);

      // Instanciación del flujo de lectura asíncrono segmentado por el tamaño de bloque óptimo
      const fileStream = fs.createReadStream(filePath, { highWaterMark: OPTIONS.blockSize });

      fileStream.on('data', (chunk) => {
        fileStream.pause(); // Activación manual de Backpressure: detiene la lectura del disco

        // Transmisión del paquete binario crudo directo al socket emisor del proxy intermediario
        server.send(chunk, rinfo.port, rinfo.address, (err) => {
          if (err) {
            console.error('[UDP] Fallo en el canal de transporte. Abortando flujo:', err.message);
            fileStream.destroy();
            return;
          }
          // Retraso artificial controlado de 1ms para evitar saturación del buffer de la tarjeta de red (Socket Overrun)
          setTimeout(() => fileStream.resume(), 1);
        });
      });

      // Manejador de fin de lectura de archivo
      fileStream.on('end', () => {
        console.log(`[UDP] Flujo completado para: ${videoName}. Transmitiendo bandera EOF.`);
        server.send(Buffer.from('__EOF__'), rinfo.port, rinfo.address);
      });

      // Manejador de excepciones en la lectura del archivo
      fileStream.on('error', (err) => {
        console.error('[UDP] Error crítico en el stream de lectura:', err.message);
        server.send(Buffer.from('__EOF__'), rinfo.port, rinfo.address);
      });
    }

  } catch (error) {
    console.error(`[UDP] Datagrama descartado de ${rinfo.address}:${rinfo.port} (Trama de control JSON inválida)`);
  }
});

// Manejador de excepciones críticas del socket UDP
server.on('error', (err) => {
  console.error(`[UDP] Error catastrófico en el socket del servidor:\n${err.stack}`);
  server.close();
});

// Vinculación e inicio de escucha en el puerto de red asignado
server.bind(OPTIONS.port, OPTIONS.host);