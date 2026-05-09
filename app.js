const storageKey = "stage-nl-data-v1";
const mediaDbName = "stage-nl-media";
const audio = document.querySelector("#mainAudio");

const state = {
  songs: [],
  playlists: [],
  pads: [],
  selectedSongId: null,
  selectedPlaylistId: null,
  currentPlaylistIndex: 0,
  selectedSyncIndex: 0,
  audioUrls: new Map(),
  effectUrls: new Map(),
  effectPlayers: [],
  fadeTimer: null,
  db: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#039;"
}[char]));

const sampleData = {
  songs: [
    {
      id: crypto.randomUUID(),
      title: "Noite de Ensaio",
      artist: "Stage NL",
      category: "Espetaculo Demo",
      genre: "Pop",
      fileName: "",
      lyrics: [
        { time: 0, text: "Luzes acesas, o palco vai chamar\nConta comigo quando a banda entrar", cue: true },
        { time: 12, text: "Segue o tempo, respira devagar\nE deixa a sala inteira cantar", cue: false }
      ]
    },
    {
      id: crypto.randomUUID(),
      title: "Final de Festa",
      artist: "Stage NL",
      category: "Festa",
      genre: "Dance",
      fileName: "",
      lyrics: [
        { time: 0, text: "Mais uma volta antes de acabar\nToda a gente pronta para saltar", cue: true },
        { time: 14, text: "Quando o refrao chegar\nNao ha ninguem para parar", cue: false }
      ]
    }
  ],
  playlists: [],
  pads: [
    { id: crypto.randomUUID(), label: "Palmas", bank: "Geral", volume: 0.85, fileName: "" },
    { id: crypto.randomUUID(), label: "Aplausos", bank: "Geral", volume: 0.9, fileName: "" },
    { id: crypto.randomUUID(), label: "Transicao", bank: "Geral", volume: 0.75, fileName: "" },
    { id: crypto.randomUUID(), label: "Festa", bank: "Geral", volume: 0.8, fileName: "" }
  ]
};
sampleData.playlists = [
  {
    id: crypto.randomUUID(),
    name: "Atuacao Demo",
    songIds: sampleData.songs.map((song) => song.id)
  }
];

function openMediaDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(mediaDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("media");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function mediaStore(mode = "readonly") {
  return state.db.transaction("media", mode).objectStore("media");
}

function putMedia(id, file) {
  if (!state.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = mediaStore("readwrite").put(file, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getMedia(id) {
  if (!state.db) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = mediaStore().get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function restoreMediaUrls() {
  await Promise.all(state.songs.map(async (song) => {
    const file = await getMedia(`song:${song.id}`);
    if (file) state.audioUrls.set(song.id, URL.createObjectURL(file));
  }));
  await Promise.all(state.pads.map(async (pad) => {
    const file = await getMedia(`pad:${pad.id}`);
    if (file) state.effectUrls.set(pad.id, URL.createObjectURL(file));
  }));
}

function saveData() {
  const payload = {
    songs: state.songs.map(({ audioUrl, ...song }) => song),
    playlists: state.playlists,
    pads: state.pads.map(({ fileUrl, ...pad }) => pad)
  };
  localStorage.setItem(storageKey, JSON.stringify(payload));
}

function loadData() {
  const saved = localStorage.getItem(storageKey);
  const data = saved ? JSON.parse(saved) : sampleData;
  state.songs = data.songs ?? [];
  state.playlists = data.playlists ?? [];
  state.pads = data.pads ?? [];
  state.selectedSongId = state.songs[0]?.id ?? null;
  state.selectedPlaylistId = state.playlists[0]?.id ?? null;
}

function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds)) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}

function parseTimestamp(value) {
  const match = value.match(/^\s*\[(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\]\s*(.*)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const decimals = Number(`0.${match[3] ?? 0}`);
  return { time: minutes * 60 + seconds + decimals, text: match[4].trim() };
}

function activeSong() {
  return state.songs.find((song) => song.id === state.selectedSongId) ?? state.songs[0];
}

function activePlaylist() {
  return state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId) ?? state.playlists[0];
}

function songById(id) {
  return state.songs.find((song) => song.id === id);
}

function blockHasCue(block, index) {
  return block?.cue ?? index === 0;
}

function sortedBlocks(song) {
  return [...(song?.lyrics ?? [])].sort((a, b) => a.time - b.time);
}

function showView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  if (viewId === "stage") renderStage();
}

function updateClocks() {
  const now = new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  $("#mainClock").textContent = now;
  $("#stageClock").textContent = now;
}

function renderAll() {
  renderCategories();
  renderSongs();
  renderEditor();
  renderPlaylists();
  renderSampler();
  renderStage();
}

function renderCategories() {
  const select = $("#categoryFilter");
  const current = select.value;
  const categories = [...new Set(state.songs.map((song) => song.category).filter(Boolean))].sort();
  select.innerHTML = `<option value="">Todas as categorias</option>${categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}`;
  select.value = categories.includes(current) ? current : "";
}

function renderSongs() {
  const query = $("#searchSongs").value.trim().toLowerCase();
  const category = $("#categoryFilter").value;
  const songs = state.songs.filter((song) => {
    const haystack = `${song.title} ${song.artist} ${song.category} ${song.genre}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!category || song.category === category);
  });

  $("#songList").innerHTML = songs.map((song) => `
    <article class="song-card">
      <div>
        <h3>${esc(song.title || "Sem titulo")}</h3>
        <div class="meta">
          <span>${esc(song.artist || "Artista por definir")}</span>
          <span class="tag">${esc(song.category || "Sem categoria")}</span>
          <span class="tag">${esc(song.genre || "Sem genero")}</span>
          <span>${esc(song.fileName || "Audio por importar nesta sessao")}</span>
        </div>
      </div>
      <div class="card-actions">
        <button data-action="select-song" data-id="${song.id}" type="button">Selecionar</button>
        <button data-action="edit-song" data-id="${song.id}" class="ghost-button" type="button">Editar</button>
        <button data-action="play-song" data-id="${song.id}" class="ghost-button" type="button">Palco</button>
      </div>
    </article>
  `).join("") || `<p class="muted">Ainda nao ha musicas nesta vista.</p>`;
}

function renderEditor() {
  const song = activeSong();
  if (!song) return;
  $("#songTitle").value = song.title ?? "";
  $("#songArtist").value = song.artist ?? "";
  $("#songCategory").value = song.category ?? "";
  $("#songGenre").value = song.genre ?? "";
  $("#editorNowPlaying").textContent = `${song.title || "Sem titulo"} ${song.fileName ? `- ${song.fileName}` : "- sem audio carregado"}`;
  renderSyncLines();
  renderEditorPreview();
}

function renderSyncLines() {
  const song = activeSong();
  $("#syncLines").innerHTML = (song?.lyrics ?? []).map((block, index) => `
    <div class="sync-line ${index === state.selectedSyncIndex ? "active" : ""}" data-index="${index}">
      <div class="sync-time-tools">
        <input data-sync-time="${index}" type="text" value="${formatTime(block.time)}" aria-label="Tempo do bloco">
        <button data-action="mark-block-time" data-index="${index}" type="button">Agora</button>
        <button data-action="toggle-block-cue" data-index="${index}" class="${blockHasCue(block, index) ? "cue-on" : "cue-off"}" type="button">
          Contador ${blockHasCue(block, index) ? "ON" : "OFF"}
        </button>
      </div>
      <textarea data-sync-text="${index}" aria-label="Texto do bloco">${esc(block.text)}</textarea>
      <div class="sync-actions">
        <button data-action="select-line" data-index="${index}" type="button">Bloco</button>
        <button data-action="remove-block" data-index="${index}" class="danger-button" type="button">Apagar</button>
      </div>
    </div>
  `).join("") || `<p>Adiciona um bloco ou cola uma letra em bruto para gerar blocos.</p>`;
}

function renderPlaylists() {
  $("#playlistList").innerHTML = state.playlists.map((playlist) => `
    <article class="playlist-card ${playlist.id === state.selectedPlaylistId ? "active" : ""}">
      <h3>${esc(playlist.name)}</h3>
      <p>${playlist.songIds.length} musicas</p>
      <button data-action="select-playlist" data-id="${playlist.id}" type="button">Abrir</button>
    </article>
  `).join("");

  const playlist = activePlaylist();
  $("#playlistName").value = playlist?.name ?? "";
  $("#playlistSongs").innerHTML = (playlist?.songIds ?? []).map((id, index) => {
    const song = songById(id);
    return `
      <div class="playlist-song">
        <strong>${index + 1}</strong>
        <span>${esc(song?.title ?? "Musica removida")}</span>
        <button data-action="playlist-up" data-index="${index}" class="ghost-button" type="button">Subir</button>
        <button data-action="playlist-remove" data-index="${index}" class="danger-button" type="button">Remover</button>
      </div>
    `;
  }).join("") || `<p>Adiciona musicas a esta playlist.</p>`;

  $("#addSongSelect").innerHTML = state.songs.map((song) => `<option value="${song.id}">${esc(song.title)}</option>`).join("");
}

function renderSampler() {
  $("#bankName").value = state.pads[0]?.bank ?? "";
  $("#padGrid").innerHTML = state.pads.map((pad) => `
    <article class="pad-card">
      <input data-pad-label="${pad.id}" type="text" value="${esc(pad.label)}" aria-label="Nome do pad">
      <button data-action="trigger-pad" data-id="${pad.id}" class="pad-trigger" type="button">${esc(pad.label)}</button>
      <label>
        Audio do efeito
        <input data-pad-file="${pad.id}" type="file" accept="audio/*">
      </label>
      <label>
        Volume
        <input data-pad-volume="${pad.id}" type="range" min="0" max="1" step="0.01" value="${pad.volume}">
      </label>
      <button data-action="remove-pad" data-id="${pad.id}" class="danger-button" type="button">Remover pad</button>
    </article>
  `).join("");
}

function renderStage() {
  const song = activeSong();
  const playlist = activePlaylist();
  const nextSong = playlist ? songById(playlist.songIds[state.currentPlaylistIndex + 1]) : null;
  $("#stageSongTitle").textContent = song ? `${song.title} - ${song.artist || "Artista"}` : "Sem musica";
  $("#stageNextSong").textContent = `Proxima: ${nextSong?.title ?? "--"}`;
  $("#stagePads").innerHTML = state.pads.map((pad) => `<button data-action="trigger-pad" data-id="${pad.id}" type="button">${esc(pad.label)}</button>`).join("");
  renderKaraoke();
  renderFullPlaylist();
}

function renderKaraoke() {
  const song = activeSong();
  const currentTime = audio.currentTime || 0;
  const blocks = sortedBlocks(song);
  const currentIndex = blocks.reduce((active, block, index) => block.time <= currentTime ? index : active, -1);
  const currentBlock = blocks[currentIndex];
  const nextIndex = blocks.findIndex((block) => block.time > currentTime + 0.05);
  const nextBlock = nextIndex >= 0 ? blocks[nextIndex] : null;
  const secondsToNext = nextBlock ? nextBlock.time - currentTime : Infinity;
  const showCue = nextBlock && blockHasCue(nextBlock, nextIndex);
  const showUpcoming = nextBlock && secondsToNext <= 8;

  $("#karaoke").innerHTML = currentBlock ? `
    <div class="lyric-block current ${showUpcoming && !showCue ? "with-upcoming" : ""}">${esc(currentBlock.text)}</div>
    ${showUpcoming && !showCue ? `<div class="lyric-block upcoming">${esc(nextBlock.text)}</div>` : ""}
  ` : showUpcoming && !showCue ? `
    <div class="lyric-block upcoming">${esc(nextBlock.text)}</div>
  ` : `<div class="lyric-block empty">${blocks.length ? "A aguardar entrada vocal" : "Seleciona uma musica para comecar."}</div>`;

  $("#vocalCountdown").textContent = showCue ? `${Math.max(0, Math.ceil(secondsToNext))}s` : "--";
  updateVocalCue(blocks, currentTime);
}

function getPreviewState(blocks, currentTime) {
  const currentIndex = blocks.reduce((active, block, index) => block.time <= currentTime ? index : active, -1);
  const currentBlock = blocks[currentIndex];
  const nextIndex = blocks.findIndex((block) => block.time > currentTime + 0.05);
  const nextBlock = nextIndex >= 0 ? blocks[nextIndex] : null;
  const secondsToNext = nextBlock ? nextBlock.time - currentTime : Infinity;
  const showCue = nextBlock && blockHasCue(nextBlock, nextIndex);
  const showUpcoming = nextBlock && secondsToNext <= 8 && !showCue;
  const previousTime = nextIndex <= 0 ? 0 : blocks[nextIndex - 1].time;
  const interval = nextBlock ? Math.max(0.1, nextBlock.time - previousTime) : 1;
  const elapsed = Math.max(0, currentTime - previousTime);
  const percent = showCue ? Math.min(100, (elapsed / interval) * 100) : 0;

  return { currentBlock, nextBlock, secondsToNext, showUpcoming, showCue, percent };
}

function renderEditorPreview() {
  const song = activeSong();
  const blocks = sortedBlocks(song);
  const { currentBlock, nextBlock, secondsToNext, showUpcoming, showCue, percent } = getPreviewState(blocks, audio.currentTime || 0);

  $("#previewCountdown").textContent = showCue ? `${Math.max(0, Math.ceil(secondsToNext))}s` : "--";
  $("#previewCueFill").style.width = `${percent}%`;
  $("#editorPreviewStage").innerHTML = showCue ? `
    <div class="preview-counter">${Math.max(0, Math.ceil(secondsToNext))}s</div>
    <div class="preview-block upcoming">${esc(nextBlock.text)}</div>
  ` : currentBlock ? `
    <div class="preview-block">${esc(currentBlock.text)}</div>
    ${showUpcoming ? `<div class="preview-block upcoming">${esc(nextBlock.text)}</div>` : ""}
  ` : showUpcoming ? `
    <div class="preview-block upcoming">${esc(nextBlock.text)}</div>
  ` : `<div class="preview-block empty">${blocks.length ? "A aguardar entrada vocal" : "Sem blocos para preview."}</div>`;
}

function updateVocalCue(blocks, currentTime) {
  const nextIndex = blocks.findIndex((block) => block.time > currentTime + 0.05);
  const fill = $("#vocalCueFill");
  const label = $("#vocalCueLabel");
  const cuePanel = document.querySelector(".stage-cue");

  if (!blocks.length) {
    cuePanel.classList.add("hidden");
    fill.style.width = "0";
    label.textContent = "Sem blocos marcados";
    return;
  }

  if (nextIndex === -1) {
    cuePanel.classList.add("hidden");
    fill.style.width = "100%";
    label.textContent = "Blocos vocais completos";
    return;
  }

  const nextBlock = blocks[nextIndex];
  if (!blockHasCue(nextBlock, nextIndex)) {
    cuePanel.classList.add("hidden");
    fill.style.width = "0";
    label.textContent = "Sem contador neste bloco";
    return;
  }

  cuePanel.classList.remove("hidden");
  const previousTime = nextIndex === 0 ? 0 : blocks[nextIndex - 1].time;
  const interval = Math.max(0.1, nextBlock.time - previousTime);
  const elapsed = Math.max(0, currentTime - previousTime);
  const percent = Math.min(100, (elapsed / interval) * 100);

  fill.style.width = `${percent}%`;
  label.textContent = nextIndex === 0 ? "Primeiro bloco vocal" : "Proximo bloco vocal";
}

function renderFullPlaylist() {
  const playlist = activePlaylist();
  $("#fullPlaylist").innerHTML = (playlist?.songIds ?? []).map((id, index) => {
    const song = songById(id);
    const active = index === state.currentPlaylistIndex ? ` aria-current="true"` : "";
    return `<li${active}>${esc(song?.title ?? "Musica removida")} <small>${esc(song?.artist ?? "")}</small></li>`;
  }).join("");
}

function loadSongAudio(song) {
  if (!song) return;
  const url = state.audioUrls.get(song.id);
  if (url && audio.src !== url) audio.src = url;
}

function playSelectedSong() {
  const song = activeSong();
  loadSongAudio(song);
  renderStage();
  if (audio.src) audio.play();
}

function stopMainAudio() {
  audio.pause();
  audio.currentTime = 0;
  audio.volume = 1;
  clearInterval(state.fadeTimer);
}

function fadeOut() {
  clearInterval(state.fadeTimer);
  const startVolume = audio.volume;
  const startedAt = Date.now();
  state.fadeTimer = setInterval(() => {
    const progress = Math.min(1, (Date.now() - startedAt) / 10000);
    audio.volume = Math.max(0, startVolume * (1 - progress));
    if (progress >= 1) {
      clearInterval(state.fadeTimer);
      audio.pause();
      audio.volume = 1;
    }
  }, 120);
}

function updateSongFromForm() {
  const song = activeSong();
  if (!song) return;
  song.title = $("#songTitle").value.trim() || "Sem titulo";
  song.artist = $("#songArtist").value.trim();
  song.category = $("#songCategory").value.trim();
  song.genre = $("#songGenre").value.trim();
  saveData();
  renderAll();
}

function parseLyricsInput() {
  const rawText = $("#lyricsInput").value.trim();
  if (!rawText) return [];

  const chunks = rawText.includes("\n\n")
    ? rawText.split(/\n\s*\n+/)
    : rawText.split(/\n+/);

  return chunks.map((chunk, index) => {
    const rows = chunk.split(/\n/).map((row) => row.trim()).filter(Boolean);
    const firstRow = rows[0] ?? "";
    const parsed = parseTimestamp(firstRow);
    const textRows = parsed ? [parsed.text, ...rows.slice(1)].filter(Boolean) : rows;
    return {
      time: parsed?.time ?? index * 8,
      text: textRows.join("\n"),
      cue: index === 0
    };
  }).filter((block) => block.text).sort((a, b) => a.time - b.time);
}

function selectPlaylistSong(offset) {
  const playlist = activePlaylist();
  if (!playlist?.songIds.length) return;
  state.currentPlaylistIndex = Math.min(Math.max(state.currentPlaylistIndex + offset, 0), playlist.songIds.length - 1);
  state.selectedSongId = playlist.songIds[state.currentPlaylistIndex];
  loadSongAudio(activeSong());
  renderAll();
}

function triggerPad(id) {
  const pad = state.pads.find((item) => item.id === id);
  const url = state.effectUrls.get(id);
  if (!pad || !url) return;
  const player = new Audio(url);
  player.volume = Number(pad.volume ?? 1);
  state.effectPlayers.push(player);
  player.addEventListener("ended", () => {
    state.effectPlayers = state.effectPlayers.filter((item) => item !== player);
  });
  player.play();
}

function stopEffects() {
  state.effectPlayers.forEach((player) => {
    player.pause();
    player.currentTime = 0;
  });
  state.effectPlayers = [];
}

function deleteSong(songId) {
  const song = songById(songId);
  if (!song) return;
  const ok = confirm(`Apagar "${song.title || "esta musica"}"? Esta acao nao pode ser anulada.`);
  if (!ok) return;

  if (state.selectedSongId === songId) stopMainAudio();
  state.songs = state.songs.filter((item) => item.id !== songId);
  state.playlists.forEach((playlist) => {
    playlist.songIds = playlist.songIds.filter((id) => id !== songId);
  });
  state.audioUrls.delete(songId);
  state.selectedSongId = state.songs[0]?.id ?? null;
  state.currentPlaylistIndex = 0;
  state.selectedSyncIndex = 0;
  saveData();
  renderAll();
}

function seekStageFromEvent(event) {
  if (!audio.duration) return;
  const bar = $("#stageSeek");
  const rect = bar.getBoundingClientRect();
  const pointerX = event.clientX ?? event.touches?.[0]?.clientX;
  if (pointerX === undefined) return;
  const percent = Math.min(1, Math.max(0, (pointerX - rect.left) / rect.width));
  audio.currentTime = percent * audio.duration;
  updateProgressUi();
}

function updateProgressUi() {
  const duration = audio.duration || 0;
  const percent = duration ? (audio.currentTime / duration) * 100 : 0;
  $("#editorTime").textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
  $("#editorSeek").value = duration ? String((audio.currentTime / duration) * 1000) : "0";
  $("#songProgress").style.width = `${percent}%`;
  $("#stageSeek").setAttribute("aria-valuenow", String(Math.round(percent)));
  renderKaraoke();
  renderEditorPreview();
}

function downloadJson() {
  const blob = new Blob([localStorage.getItem(storageKey) ?? JSON.stringify(sampleData, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const stamp = new Date().toLocaleString("sv-SE").replace(/[-:]/g, "").replace(" ", "_");
  link.href = URL.createObjectURL(blob);
  link.download = `Palco_NL_${stamp}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindEvents() {
  $$(".nav-item, .nav-jump").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $("#searchSongs").addEventListener("input", renderSongs);
  $("#categoryFilter").addEventListener("change", renderSongs);
  $("#newSong").addEventListener("click", () => {
    const song = { id: crypto.randomUUID(), title: "Nova musica", artist: "", category: "", genre: "", fileName: "", lyrics: [] };
    state.songs.unshift(song);
    state.selectedSongId = song.id;
    saveData();
    renderAll();
    showView("editor");
  });
  $("#saveSong").addEventListener("click", updateSongFromForm);
  $("#deleteCurrentSong").addEventListener("click", () => {
    const song = activeSong();
    if (!song) return;
    deleteSong(song.id);
    showView("library");
  });
  $("#parseLyrics").addEventListener("click", () => {
    const song = activeSong();
    if (!song) return;
    const blocks = parseLyricsInput();
    if (!blocks.length) return;
    song.lyrics = blocks;
    state.selectedSyncIndex = 0;
    $("#lyricsInput").value = "";
    saveData();
    renderAll();
  });
  $("#addBlock").addEventListener("click", () => {
    const song = activeSong();
    if (!song) return;
    const lastBlock = song.lyrics.at(-1);
    const block = {
      time: lastBlock ? lastBlock.time + 8 : Math.floor(audio.currentTime || 0),
      text: "Novo bloco",
      cue: !song.lyrics.length
    };
    song.lyrics.push(block);
    state.selectedSyncIndex = song.lyrics.length - 1;
    saveData();
    renderEditor();
    renderStage();
  });
  $("#markLine").addEventListener("click", () => {
    const song = activeSong();
    if (!song?.lyrics?.length) return;
    const selectedBlock = song.lyrics[state.selectedSyncIndex];
    selectedBlock.time = audio.currentTime || 0;
    saveData();
    renderEditor();
    renderStage();
  });
  $("#clearLyrics").addEventListener("click", () => {
    const song = activeSong();
    song.lyrics = song.lyrics.map((line, index) => ({ ...line, time: index * 5 }));
    saveData();
    renderEditor();
    renderStage();
  });

  $("#songList").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.selectedSongId = button.dataset.id;
    const playlist = activePlaylist();
    const playlistIndex = playlist?.songIds.indexOf(state.selectedSongId) ?? -1;
    if (playlistIndex >= 0) state.currentPlaylistIndex = playlistIndex;
    if (button.dataset.action === "edit-song") showView("editor");
    if (button.dataset.action === "play-song") {
      showView("stage");
      playSelectedSong();
    }
    renderAll();
  });

  $("#syncLines").addEventListener("click", (event) => {
    const removeButton = event.target.closest("button[data-action='remove-block']");
    if (removeButton) {
      const song = activeSong();
      const index = Number(removeButton.dataset.index);
      if (!song?.lyrics?.[index]) return;
      song.lyrics.splice(index, 1);
      state.selectedSyncIndex = song.lyrics.length ? Math.max(0, Math.min(state.selectedSyncIndex, song.lyrics.length - 1)) : 0;
      saveData();
      renderEditor();
      renderStage();
      return;
    }

    const cueButton = event.target.closest("button[data-action='toggle-block-cue']");
    if (cueButton) {
      const song = activeSong();
      const index = Number(cueButton.dataset.index);
      if (!song?.lyrics?.[index]) return;
      song.lyrics[index].cue = !blockHasCue(song.lyrics[index], index);
      state.selectedSyncIndex = index;
      saveData();
      renderEditor();
      renderStage();
      return;
    }

    const markButton = event.target.closest("button[data-action='mark-block-time']");
    if (markButton) {
      const song = activeSong();
      const index = Number(markButton.dataset.index);
      if (!song?.lyrics?.[index]) return;
      const selectedBlock = song.lyrics[index];
      selectedBlock.time = audio.currentTime || 0;
      state.selectedSyncIndex = index;
      saveData();
      renderEditor();
      renderStage();
      return;
    }

    const row = event.target.closest(".sync-line");
    if (!row) return;
    state.selectedSyncIndex = Number(row.dataset.index);
    if (event.target.matches("input, textarea")) return;
    renderSyncLines();
  });

  $("#syncLines").addEventListener("change", (event) => {
    const song = activeSong();
    const timeIndex = event.target.dataset.syncTime;
    const textIndex = event.target.dataset.syncText;
    if (timeIndex !== undefined) {
      const parsed = parseTimestamp(`[${event.target.value}] x`);
      song.lyrics[Number(timeIndex)].time = parsed?.time ?? 0;
    }
    if (textIndex !== undefined) song.lyrics[Number(textIndex)].text = event.target.value;
    saveData();
    renderStage();
    renderEditorPreview();
  });

  $("#audioImport").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    let song = activeSong();
    if (!song) {
      song = { id: crypto.randomUUID(), title: "Nova musica", artist: "", category: "", genre: "", fileName: "", lyrics: [] };
      state.songs.unshift(song);
      state.selectedSongId = song.id;
    }
    if (!song.title || song.title === "Nova musica") song.title = file.name.replace(/\.[^.]+$/, "");
    song.fileName = file.name;
    await putMedia(`song:${song.id}`, file);
    state.audioUrls.set(song.id, URL.createObjectURL(file));
    saveData();
    renderAll();
  });

  $("#newPlaylist").addEventListener("click", () => {
    const playlist = { id: crypto.randomUUID(), name: "Nova playlist", songIds: [] };
    state.playlists.unshift(playlist);
    state.selectedPlaylistId = playlist.id;
    saveData();
    renderPlaylists();
  });
  $("#playlistName").addEventListener("input", () => {
    const playlist = activePlaylist();
    if (!playlist) return;
    playlist.name = $("#playlistName").value;
    saveData();
    renderPlaylists();
  });
  $("#playlistList").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.selectedPlaylistId = button.dataset.id;
    state.currentPlaylistIndex = 0;
    const playlist = activePlaylist();
    state.selectedSongId = playlist?.songIds[0] ?? state.selectedSongId;
    renderAll();
  });
  $("#addSongToPlaylist").addEventListener("click", () => {
    const playlist = activePlaylist();
    const songId = $("#addSongSelect").value;
    if (!playlist || !songId) return;
    playlist.songIds.push(songId);
    saveData();
    renderAll();
  });
  $("#playlistSongs").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    const playlist = activePlaylist();
    if (!button || !playlist) return;
    const index = Number(button.dataset.index);
    if (button.dataset.action === "playlist-remove") playlist.songIds.splice(index, 1);
    if (button.dataset.action === "playlist-up" && index > 0) {
      [playlist.songIds[index - 1], playlist.songIds[index]] = [playlist.songIds[index], playlist.songIds[index - 1]];
    }
    saveData();
    renderAll();
  });

  $("#newPad").addEventListener("click", () => {
    state.pads.push({ id: crypto.randomUUID(), label: "Novo efeito", bank: $("#bankName").value || "Geral", volume: 0.8, fileName: "" });
    saveData();
    renderSampler();
    renderStage();
  });
  $("#bankName").addEventListener("input", () => {
    state.pads.forEach((pad) => pad.bank = $("#bankName").value);
    saveData();
  });
  $("#padGrid").addEventListener("input", (event) => {
    const labelId = event.target.dataset.padLabel;
    const volumeId = event.target.dataset.padVolume;
    if (labelId) state.pads.find((pad) => pad.id === labelId).label = event.target.value;
    if (volumeId) state.pads.find((pad) => pad.id === volumeId).volume = event.target.value;
    saveData();
    renderStage();
  });
  $("#padGrid").addEventListener("change", async (event) => {
    const fileId = event.target.dataset.padFile;
    const file = event.target.files?.[0];
    if (!fileId || !file) return;
    const pad = state.pads.find((item) => item.id === fileId);
    pad.fileName = file.name;
    await putMedia(`pad:${fileId}`, file);
    state.effectUrls.set(fileId, URL.createObjectURL(file));
    saveData();
  });
  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='trigger-pad']");
    if (button) triggerPad(button.dataset.id);
    if (event.target.closest("button[data-action='remove-pad']")) {
      const id = event.target.closest("button").dataset.id;
      state.pads = state.pads.filter((pad) => pad.id !== id);
      saveData();
      renderAll();
    }
  });
  $("#stopEffects").addEventListener("click", stopEffects);

  $("#editorPlay").addEventListener("click", playSelectedSong);
  $("#editorPause").addEventListener("click", () => audio.pause());
  $("#editorStop").addEventListener("click", stopMainAudio);
  $("#stagePlay").addEventListener("click", playSelectedSong);
  $("#stagePause").addEventListener("click", () => audio.pause());
  $("#stageStop").addEventListener("click", stopMainAudio);
  $("#stageFade").addEventListener("click", fadeOut);
  $("#stagePrev").addEventListener("click", () => selectPlaylistSong(-1));
  $("#stageNext").addEventListener("click", () => selectPlaylistSong(1));
  $("#openPlaylist").addEventListener("click", () => $("#playlistDialog").showModal());
  $("#closePlaylist").addEventListener("click", () => $("#playlistDialog").close());
  $("#stageSeek").addEventListener("pointerdown", (event) => {
    seekStageFromEvent(event);
    $("#stageSeek").setPointerCapture(event.pointerId);
  });
  $("#stageSeek").addEventListener("pointermove", (event) => {
    if (event.buttons !== 1) return;
    seekStageFromEvent(event);
  });
  $("#stageSeek").addEventListener("keydown", (event) => {
    if (!audio.duration) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
    if (event.key === "ArrowRight") audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    if (event.key === "Home") audio.currentTime = 0;
    if (event.key === "End") audio.currentTime = audio.duration;
    updateProgressUi();
  });

  $("#exportData").addEventListener("click", downloadJson);
  $("#dataImport").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const imported = JSON.parse(await file.text());
    state.songs = imported.songs ?? [];
    state.playlists = imported.playlists ?? [];
    state.pads = imported.pads ?? [];
    state.selectedSongId = state.songs[0]?.id ?? null;
    state.selectedPlaylistId = state.playlists[0]?.id ?? null;
    saveData();
    renderAll();
  });

  audio.addEventListener("timeupdate", () => {
    updateProgressUi();
  });
  $("#editorSeek").addEventListener("input", () => {
    if (!audio.duration) return;
    audio.currentTime = (Number($("#editorSeek").value) / 1000) * audio.duration;
  });
  audio.addEventListener("ended", () => selectPlaylistSong(1));
}

async function init() {
  state.db = await openMediaDb();
  loadData();
  await restoreMediaUrls();
  bindEvents();
  renderAll();
  updateClocks();
  setInterval(updateClocks, 1000);
}

init().catch((error) => {
  console.error(error);
  loadData();
  bindEvents();
  renderAll();
  updateClocks();
  setInterval(updateClocks, 1000);
});
