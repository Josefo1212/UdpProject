const videoSelect = document.getElementById("videoSelect");
const player = document.getElementById("player");
const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = message;
}

function getMimeType(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const mimeByExt = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo"
  };

  return mimeByExt[ext] || "";
}

async function loadVideos() {
  try {
    setStatus("Cargando lista de videos...");
    const response = await fetch("/api/videos");
    if (!response.ok) {
      throw new Error("Respuesta invalida del servidor");
    }

    const payload = await response.json();
    const videos = Array.isArray(payload) ? payload : payload.files;
    videoSelect.innerHTML = "";

    if (!Array.isArray(videos) || videos.length === 0) {
      videoSelect.innerHTML = "<option value=\"\">Sin videos disponibles</option>";
      setStatus("No se encontraron videos.");
      return;
    }

    videoSelect.appendChild(new Option("Selecciona un video", ""));
    videos.forEach((name) => {
      videoSelect.appendChild(new Option(name, name));
    });

    setStatus("Lista lista. Selecciona un video.");
  } catch (error) {
    videoSelect.innerHTML = "<option value=\"\">Error al cargar</option>";
    setStatus("No se pudo cargar la lista de videos.");
  }
}

videoSelect.addEventListener("change", () => {
  const selected = videoSelect.value;
  if (!selected) {
    player.removeAttribute("src");
    player.load();
    setStatus("Selecciona un video para comenzar.");
    return;
  }

  const source = `/api/stream?video=${encodeURIComponent(selected)}`;
  player.src = source;
  player.load();
  player.play().catch(() => {
    setStatus("Presiona reproducir para iniciar.");
  });
  const mime = getMimeType(selected);
  if (mime && player.canPlayType(mime) === "") {
    setStatus("Formato detectado, puede no ser compatible con el navegador.");
    return;
  }
  setStatus(`Reproduciendo: ${selected}`);
});

loadVideos();
