import { RewaOraciones } from './rewa-oraciones.js?v=rewa1';
import { MAX_FILE_BYTES, mergeSentenceBank } from './sentence-file.js?v=excel1';
import { sentenceFileTask } from './sentence-file-client.js?v=excel1';
import { SentenceChallenge, formatTime } from './sentence-challenge.js?v=eclipse15';
import { SentenceAudio } from './sentence-audio.js?v=eclipse15';
import { HandTracker } from "./handTracking.js";
import { DwellSelector } from "./dwell-selector.js";
import { cleanSentence, cleanContext, sentenceWords, isValidSentence, loadSentences, saveSentences, shuffledIndexes, isCorrectOrder, classifyHand } from "./sentence-engine.js";

const $ = (id) => document.getElementById(id);
const setText = (id,text) => { const element=$(id); if(element.textContent!==String(text))element.textContent=text; };
const ui = {
  setup: $("setupView"), board: $("boardView"), list: $("sentenceList"), count: $("bankCount"),
  form: $("sentenceForm"), input: $("sentenceInput"), contextInput: $("contextInput"), editorMessage: $("editorMessage"),
  cameraButton: $("startCameraBtn"), pointerButton: $("startPointerBtn"), back: $("backToSetupBtn"),
  tracking: $("trackingStatus"), round: $("roundLabel"), hint: $("gestureHint"), contextCard: $("contextCard"), activeContext: $("activeContext"),
  surface: $("playSurface"), slots: $("slotArea"), tray: $("wordTray"),
  cursor: $("handCursor"), ghost: $("dragGhost"), feedback: $("feedback"),
  boardActions: $("boardGestureActions"), victoryAim: $("victoryAim"),
  check: $("checkBtn"), retry: $("retryBtn"),
  cameraPreview: $("cameraPreview"), video: $("webcamVideo"), videoOverlay: $("webcamOverlay")
};

export class SentenceGame {
  constructor() {
    this.challenge = new SentenceChallenge();
    this.audio = new SentenceAudio();
    this.stolenWordId = null;
    this.lastClockAt = null;
    this.sentences = loadSentences();
    this.selectedIndex = 0;
    this.words = [];
    this.order = [];
    this.placements = [];
    this.grabbed = null;
    this.mode = "pointer";
    this.tracker = new HandTracker(ui.video, ui.videoOverlay);
    this.lastResultAt = -1;
    this.pose = "unknown";
    this.poseCandidate = "unknown";
    this.poseSamples = 0;
    this.dwell = new DwellSelector(5000);
    this.dwellNeedsExit = false;
    this.completed = false;
    this.activePointer = null;
    this.boardObserver = new ResizeObserver(() => this.fitBoard());
    this.boardObserver.observe(ui.surface);
    this.bindEvents();
    this.renderSentences();
    this.rewa = new RewaOraciones(this);
    requestAnimationFrame(t=>this.challengeTick(t));
  }

  bindEvents() {
    document.addEventListener('visibilitychange',()=>{this.lastClockAt=null;});
    $('sentenceMuteBtn').addEventListener('click',()=>{
      const muted=this.audio.toggle();$('sentenceMuteBtn').textContent=muted?'🔇 Sonido':'🔊 Sonido';
      $('sentenceMuteBtn').setAttribute('aria-pressed',String(muted));
    });
    const fullscreen = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
        $('settingsDialog').close();
      } catch {
        const message = document.body.dataset.view === 'board' ? ui.feedback : $('settingsMessage');
        message.textContent = 'Amplía la ventana para ver mejor el juego.';
      }
    };
    $('menuSettingsBtn').addEventListener('click', () => $('settingsDialog').showModal());
    $('menuFullBtn').addEventListener('click', fullscreen);
    $('menuPlayBtn').addEventListener('click', () => { document.body.dataset.view='bank'; $('bankTitle').textContent='ELIGE TU MISIÓN'; });
    $('menuBankBtn').addEventListener('click', () => { document.body.dataset.view='bank'; $('bankTitle').textContent='Banco de oraciones'; });
    $('menuBackBtn').addEventListener('click', () => { document.body.dataset.view='menu'; window.scrollTo(0,0); });
    $('victoryNextBtn').addEventListener('click', () => { this.selectedIndex=(this.selectedIndex+1)%this.sentences.length; this.resumeFromVictory(); });
    $('victoryReplayBtn').addEventListener('click', () => this.resumeFromVictory());
    $('victoryMenuBtn').addEventListener('click', () => { $('victoryView').classList.add('hidden'); this.backToSetup(); });
    $('fullscreenBtn').addEventListener('click', fullscreen);
    $('importSentencesBtn').addEventListener('click',()=>$('sentenceFileInput').click());
    $('sentenceFileInput').addEventListener('change',async event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;
      this.pendingSentences=null;$('sentenceImportPreview').hidden=true;
      const button=$('importSentencesBtn');button.disabled=true;
      const message=$('sentenceFileMessage');message.textContent='Leyendo el archivo…';
      try {
        if(file.size>MAX_FILE_BYTES)throw new Error('El archivo supera los 5 MB.');
        const {sentences}=await sentenceFileTask({action:'import',name:file.name,buffer:await file.arrayBuffer()});
        this.pendingSentences=sentences;
        $('sentenceImportSummary').textContent=`${file.name}: ${sentences.length} ${sentences.length===1?'oración lista':'oraciones listas'} para cargar.`;
        $('sentenceImportPreview').hidden=false;message.textContent='Archivo revisado. El banco aún no se ha cambiado.';
      } catch(error) {message.textContent=error.message;}
      finally {button.disabled=false;}
    });
    $('cancelSentenceImportBtn').addEventListener('click',()=>{
      this.pendingSentences=null;$('sentenceImportPreview').hidden=true;$('sentenceFileMessage').textContent='Carga cancelada. Se conservó tu banco.';
    });
    $('appendSentencesBtn').addEventListener('click',()=>this.applySentenceImport(false));
    $('replaceSentencesBtn').addEventListener('click',()=>this.applySentenceImport(true));
    ui.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const sentence = cleanSentence(ui.input.value);
      if (!isValidSentence(sentence)) {
        ui.editorMessage.textContent = "Escribe una oración de 3 a 12 palabras (máximo 180 caracteres).";
        return;
      }
      const context = cleanContext(ui.contextInput.value);
      if(this.sentences.length>=300) {ui.editorMessage.textContent='El banco admite hasta 300 oraciones.';return;}
      const next = [...this.sentences, { sentence, context }];
      if (!this.persist(next)) return;
      this.selectedIndex = next.length - 1;
      ui.input.value = "";
      ui.contextInput.value = "";
      ui.editorMessage.textContent = "Oración agregada. Ya puedes jugarla.";
      this.renderSentences();
    });
    ui.cameraButton.addEventListener("click", () => this.startWithCamera());
    ui.pointerButton.addEventListener("click", () => this.start("pointer"));
    ui.back.addEventListener("click", () => this.backToSetup());
    ui.check.addEventListener("click", () => this.checkAnswer());
    ui.retry.addEventListener("click", () => this.startRound());
    for (const button of document.querySelectorAll("[data-dwell-for]")) {
      button.addEventListener("click", () => $(button.dataset.dwellFor).click());
    }
    ui.surface.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    ui.surface.addEventListener("pointermove", (event) => this.onPointerMove(event));
    ui.surface.addEventListener("pointerup", (event) => this.onPointerUp(event));
    ui.surface.addEventListener("pointercancel", () => this.cancelPointer());
    window.addEventListener("beforeunload", () => this.tracker.stopCamera());
  }

  applySentenceImport(replace) {
    if(!this.pendingSentences)return;
    try {
      const count=this.pendingSentences.length;
      const next=mergeSentenceBank(this.sentences,this.pendingSentences,replace);
      if(!this.persist(next)) {
        $('sentenceFileMessage').textContent='No se pudo guardar. Tu banco anterior sigue disponible.';return;
      }
      this.selectedIndex=replace?0:next.length-count;
      this.pendingSentences=null;$('sentenceImportPreview').hidden=true;
      this.renderSentences();ui.editorMessage.textContent='';
      $('sentenceFileMessage').textContent=`${count} ${count===1?'oración cargada':'oraciones cargadas'}. Ya puedes jugar. Se guardaron en este navegador.`;
    } catch(error) {$('sentenceFileMessage').textContent=error.message;}
  }

  persist(sentences) {
    try {
      saveSentences(sentences);
      this.sentences = sentences;
      return true;
    } catch {
      ui.editorMessage.textContent = "No se pudo guardar en este navegador. Revisa si hay espacio disponible.";
      return false;
    }
  }

  renderSentences() {
    ui.list.replaceChildren();
    ui.count.textContent = `${this.sentences.length} ${this.sentences.length === 1 ? "oración" : "oraciones"}`;
    ui.cameraButton.disabled = ui.pointerButton.disabled = this.sentences.length === 0;
    this.sentences.forEach(({ sentence, context }, index) => {
      const row = document.createElement("div");
      row.className = `sentence-row${index === this.selectedIndex ? " selected" : ""}`;
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "sentence-choice";
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-checked", String(index === this.selectedIndex));
      const number = document.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      const text = document.createElement("span");
      text.className = "sentence-text";
      text.textContent = sentence;
      choice.append(number, text);
      if (context) {
        const prompt = document.createElement("small");
        prompt.className = "sentence-context";
        prompt.textContent = context;
        choice.append(prompt);
      }
      choice.addEventListener("click", () => { this.selectedIndex = index; this.renderSentences(); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-btn";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Eliminar oración ${index + 1}`);
      remove.addEventListener("click", () => {
        const next = this.sentences.filter((_, i) => i !== index);
        if (!this.persist(next)) return;
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, next.length - 1));
        this.renderSentences();
      });
      row.append(choice, remove);
      ui.list.append(row);
    });
  }

  async startWithCamera() {
    if (!this.sentences.length) return;
    ui.cameraButton.disabled = true;
    ui.cameraButton.textContent = "Preparando cámara…";
    ui.tracking.textContent = "Cargando seguimiento…";
    try {
      if (!this.tracker.isInitialized) await this.tracker.initialize((message) => { ui.tracking.textContent = message; });
      await this.tracker.startCamera();
      ui.cameraPreview.classList.remove("hidden");
      this.start("camera");
      this.cameraLoopActive = true;
      requestAnimationFrame(() => this.cameraTick());
    } catch (error) {
      console.warn("No se pudo iniciar la cámara:", error);
      ui.editorMessage.textContent = "No pude abrir la cámara. Puedes probar el juego con mouse o pantalla táctil.";
      ui.tracking.textContent = "Cámara no disponible";
    } finally {
      ui.cameraButton.disabled = false;
      ui.cameraButton.textContent = "Jugar con la cámara →";
    }
  }

  start(mode) {
    if (!this.sentences.length) return;
    this.challenge.reset();
    this.audio.init();
    this.mode = mode;
    document.body.dataset.controls = mode;
    document.body.dataset.view="board";
    $('victoryView').classList.add('hidden');
    ui.setup.classList.add("hidden");
    ui.board.classList.remove("hidden");
    window.scrollTo({top:0,behavior:"instant"});
    ui.tracking.textContent = mode === "camera" ? "Buscando mano…" : mode === "rewa" ? "Control REWA" : "Control táctil";
    ui.tracking.classList.toggle("active", mode === "camera");
    ui.cursor.classList.toggle("hidden", mode !== "camera");
    ui.hint.textContent = mode === "camera"
      ? "Apunta a una palabra, cierra el puño para tomarla y abre la mano sobre un espacio para soltarla."
      : "Toca una palabra y luego un espacio; también puedes arrastrarla.";
    this.startRound();
  }

  startRound() {
    this.clearEnemy();
    this.resetDwell();
    if (this.grabbed !== null) this.cancelGrab();
    const entry = this.sentences[this.selectedIndex];
    this.words = sentenceWords(entry.sentence);
    this.challenge.newRound(this.words.length);
    this.lastClockAt = null;
    this.updateClock();
    ui.activeContext.textContent = entry.context || "Ordena las palabras";
    const contextLength = ui.activeContext.textContent.length;
    const contextFont = Math.min(3.1, Math.sqrt(365 / contextLength));
    ui.contextCard.style.setProperty('--context-font', `${contextFont}cqw`);
    this.order = shuffledIndexes(this.words.length);
    this.placements = Array(this.words.length).fill(null);
    this.completed = false;
    ui.surface.classList.remove("mission-complete");
    const round = this.selectedIndex + 1;
    ui.round.textContent = String(round).padStart(2, '0');
    ui.round.setAttribute('aria-label', `Misión ${round} de ${this.sentences.length}`);
    ui.feedback.textContent = "";
    ui.feedback.className = "feedback";
    this.renderBoard();
  }

  clearEnemy() {
    this.stolenWordId=null;this.enemyTarget=null;
    $('sentenceEnemy').hidden=true;$('eclipseWarning').hidden=true;
    $('enemyWord').hidden=true;
  }

  updateClock() {
    const current=formatTime(this.challenge.elapsed),total=formatTime(this.challenge.total);
    if($('sentenceTime').textContent!==current)$('sentenceTime').textContent=current;
    if($('sentenceTotal').textContent!==total)$('sentenceTotal').textContent=total;
    setText('sentenceSolved',this.challenge.results.length);
  }

  challengeTick(now) {
    this.rewa?.tick(now);
    const delta=this.lastClockAt===null?0:now-this.lastClockAt;this.lastClockAt=now;
    const onBoard=document.body.dataset.view==='board' && !this.completed;
    const active=onBoard && !document.hidden && (this.mode!=='camera'||this.tracker.isTracking) && (this.mode!=='rewa'||this.rewa.ready(now));
    if(onBoard) {
      setText('sentenceClockState',active?'':(this.mode==='rewa'?'Pausa · conecta REWA':'Pausa · buscando mano'));
      const placed=this.placements.filter(v=>v!==null).length;
      const eligible=placed>0 && placed<this.words.length;
      for(const event of this.challenge.step(delta,active,eligible))this.handleMischief(event);
      this.updateClock();this.drawEnemy();
      const c=this.challenge;
      const remaining=Math.max(0,c.nextVisit-c.elapsed);
      const waiting=c.phase==='waiting';
      setText('eclipseSeconds',waiting?Math.ceil(remaining/1000):'☾');
      const circle=$('eclipseCountdown');
      const status=waiting?`Eclipse llega en ${Math.ceil(remaining/1000)} segundos`:'Eclipse está volando';
      if(circle.getAttribute('aria-label')!==status) {circle.setAttribute('aria-label',status);circle.title=status;}
      const ringState=waiting?(remaining<=3000?'soon':'waiting'):'flying';
      if(circle.dataset.state!==ringState)circle.dataset.state=ringState;
      const ring=Math.round((waiting?Math.min(1,remaining/15000):1)*100);
      if(this.lastRing!==ring) {$('eclipseRing').style.strokeDashoffset=String(100-ring);this.lastRing=ring;}

    }
    requestAnimationFrame(t=>this.challengeTick(t));
  }

  handleMischief(event) {
    const warning=$('eclipseWarning');
    if(event==='approach' || event==='flyby') {
      const candidates=this.placements.map((id,index)=>({id,index})).filter(p=>p.id!==null && p.id!==this.grabbed);
      this.enemyTarget=event==='approach'?candidates[Math.floor(Math.random()*candidates.length)]:null;
      this.enemyDestination={x:83,y:38};
      if(this.enemyTarget) {
        const rect=ui.slots.children[this.enemyTarget.index].getBoundingClientRect();
        const board=ui.board.getBoundingClientRect();
        this.enemyDestination={x:(rect.left+rect.width*.6-board.left)/board.width*100,y:(rect.top+rect.height*.4-board.top)/board.height*100};
      }
      $('sentenceEnemy').hidden=false;warning.hidden=false;
      warning.textContent=this.enemyTarget?'¡Eclipse viene por una palabra!':'¡Eclipse pasa con su jetpack!';this.audio.play('jet');
    }
    if(event==='steal') {
      const target=this.enemyTarget;
      if(target && this.placements[target.index]===target.id && this.grabbed!==target.id) {
        this.stolenWordId=target.id;this.placements[target.index]=null;
        $('enemyWord').textContent=this.words[target.id];$('enemyWord').hidden=false;
        this.resetDwell();this.renderBoard();
        warning.textContent=`¡Eclipse devuelve «${this.words[target.id]}»! Puedes recuperarla.`;
        this.audio.play('trick');
      } else { warning.textContent='¡Esquivaste su travesura!'; }
    }
    if(event==='returned' || event==='cancel') {
      const returnedWord=this.stolenWordId!==null;
      this.clearEnemy();this.renderBoard();
      if(event==='returned' && returnedWord) {ui.feedback.textContent='¡Continúa! La palabra volvió a las disponibles.';ui.feedback.className='feedback';}
    }
  }

  drawEnemy() {
    const c=this.challenge;
    const enemy=$('sentenceEnemy');
    if(enemy.hidden || !this.enemyDestination)return;
    const target=this.enemyDestination;
    const progress=c.phase==='approach'?Math.min(1,c.phaseTime/c.approachDuration):Math.min(1,c.phaseTime/c.returnDuration);
    const eased=progress*progress*(3-2*progress);
    const carrying=this.stolenWordId!==null;
    const end=carrying?{x:52,y:60}:{x:108,y:20};
    const x=c.phase==='approach'?105+(target.x-105)*eased:target.x+(end.x-target.x)*eased;
    const y=(c.phase==='approach'?35+(target.y-35)*eased:target.y+(end.y-target.y)*eased)-Math.sin(progress*Math.PI)*5;
    enemy.style.setProperty('--bank',`${(c.phase==='approach'?-1:1)*Math.sin(progress*Math.PI)*8}deg`);
    enemy.style.left=`${x}%`;enemy.style.top=`${y}%`;
    enemy.style.opacity=c.phase==='return'?String(1-Math.max(0,(progress-.7)/.3)): '1';
  }

  fitBoard() {
    if (!this.words.length || ui.board.classList.contains('hidden')) return;
    const width = ui.slots.clientWidth;
    const height = Math.min(ui.slots.clientHeight, ui.tray.clientHeight);
    if (!width || !height) return;
    const gap = Math.max(3, Math.round(width * .009));
    const rows = Math.ceil(this.words.length / 6);
    const columns = Math.ceil(this.words.length / rows);
    const tileWidth = Math.min(width * .24, Math.floor((width - gap * (columns - 1)) / columns));
    const trayWidth = Math.min(tileWidth, Math.floor((ui.tray.clientWidth - gap * (columns - 1)) / columns));
    const tileHeight = Math.floor((height - gap * rows) / rows);
    const font = Math.min(tileHeight * .4, width * .044);
    ui.surface.style.setProperty('--tile-width', `${tileWidth}px`);
    ui.surface.style.setProperty('--tray-tile-width', `${trayWidth}px`);
    ui.surface.style.setProperty('--tile-height', `${tileHeight}px`);
    ui.surface.style.setProperty('--tray-tile-height', `${Math.round(tileHeight * (rows === 1 ? .75 : .9))}px`);
    ui.surface.style.setProperty('--tile-font', `${font}px`);
    ui.surface.style.setProperty('--tile-gap', `${gap}px`);
  }

  renderBoard() {
    const placed=this.placements.filter(v=>v!==null).length;
    $('placedCount').textContent=`${placed} / ${this.words.length}`;
    ui.boardActions.classList.toggle("hidden", placed !== this.words.length);
    ui.slots.replaceChildren();
    this.placements.forEach((wordId, index) => {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.slotIndex = String(index);
      slot.dataset.number = String(index + 1);
      slot.setAttribute("aria-label", `Espacio ${index + 1}${wordId === null ? ", vacío" : `, ${this.words[wordId]}`}`);
      if (wordId !== null) slot.append(this.makeTile(wordId));
      ui.slots.append(slot);
    });
    ui.tray.replaceChildren();
    for (const wordId of this.order) {
      if (wordId !== this.grabbed && wordId !== this.stolenWordId && !this.placements.includes(wordId)) ui.tray.append(this.makeTile(wordId));
    }
    this.fitBoard();
    ui.ghost.classList.toggle("hidden", this.grabbed === null);
    if (this.grabbed !== null) ui.ghost.textContent = this.words[this.grabbed];
  }

  makeTile(wordId) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "word-tile";
    tile.dataset.wordId = String(wordId);
    tile.textContent = this.words[wordId];
    tile.style.setProperty('--word-width', Math.min(this.words[wordId].length, 18) * .67);
    tile.setAttribute("aria-label", `Palabra ${this.words[wordId]}`);
    return tile;
  }

  beginGrab(wordId, point) {
    if (this.completed || this.grabbed !== null || !Number.isInteger(wordId)) return;
    this.grabbed = wordId;
    const formerSlot = this.placements.indexOf(wordId);
    if (formerSlot >= 0) this.placements[formerSlot] = null;
    this.renderBoard();
    this.moveGhost(point);
    ui.feedback.textContent = `Lleva «${this.words[wordId]}» a un espacio y abre la mano.`;
    ui.feedback.className = "feedback";
  }

  beginGrabAt(point) {
    const target = document.elementFromPoint(point.x, point.y)?.closest(".word-tile");
    if (!target || !ui.surface.contains(target)) return;
    this.beginGrab(Number(target.dataset.wordId), point);
  }

  releaseAt(point) {
    if (this.grabbed === null) return;
    const slot = document.elementFromPoint(point.x, point.y)?.closest(".slot");
    if (!slot || !ui.surface.contains(slot)) {
      this.cancelGrab();
      ui.feedback.textContent = "Suelta la palabra sobre uno de los espacios numerados.";
      return;
    }
    const index = Number(slot.dataset.slotIndex);
    this.placements[index] = this.grabbed;
    this.audio.play("place");
    this.grabbed = null;
    this.renderBoard();
    const allPlaced = this.placements.every(value => value !== null);
    ui.feedback.textContent = allPlaced
      ? (this.mode === "camera" ? "¡Ya están todas!" : "¡Ya están todas! Pulsa «Comprobar».")
      : "Bien. Continúa con la siguiente palabra.";
  }

  cancelGrab() {
    this.grabbed = null;
    this.renderBoard();
  }

  moveGhost(point) {
    if (this.grabbed === null || !point) return;
    const rect = ui.surface.getBoundingClientRect();
    ui.ghost.style.left = `${point.x - rect.left}px`;
    ui.ghost.style.top = `${point.y - rect.top}px`;
  }

  checkAnswer() {
    if (this.completed) return;
    if (this.grabbed !== null) this.cancelGrab();
    if (this.placements.some((value) => value === null)) {
      ui.feedback.textContent = "Todavía faltan palabras. Llena todos los espacios.";
      ui.feedback.className = "feedback error";
      return;
    }
    if (!isCorrectOrder(this.placements)) {
      this.audio.play("wrong");
      ui.feedback.textContent = "Casi. Cambia las palabras de lugar e inténtalo otra vez.";
      ui.feedback.className = "feedback error";
      return;
    }
    this.completed = true;
    const result=this.challenge.complete(this.sentences[this.selectedIndex].sentence);
    this.clearEnemy();this.audio.play('win');this.updateClock();
    $('sentenceResult').textContent=`⏱ Esta oración: ${formatTime(result.ms)} · ${(Math.floor(result.ms/100)/10).toFixed(1)} segundos`;
    $('sentenceSessionResult').textContent=`★ ${this.challenge.results.length} ${this.challenge.results.length===1?"oración completada":"oraciones completadas"} · Tiempo total: ${formatTime(this.challenge.total)}`;
    $('sentenceTimeList').replaceChildren(...this.challenge.results.map((item,i)=>{
      const li=document.createElement('li');li.textContent=`${i+1}. ${item.sentence} — ${(Math.floor(item.ms/100)/10).toFixed(1)} s`;return li;
    }));
    ui.surface.classList.add("mission-complete");
    ui.feedback.textContent = `¡Excelente! La oración es: ${this.sentences[this.selectedIndex].sentence}`;
    ui.feedback.className = "feedback success";
    const victorySentence = $('victorySentence');
    victorySentence.replaceChildren(...this.words.map(word => {
      const tile = document.createElement('span');
      tile.textContent = word;
      return tile;
    }));
    victorySentence.classList.toggle('many-words', this.words.length > 6);
    const wordLength = this.words.join('').length;
    const victoryFont = Math.min(3.15, (63 - this.words.length * 2.3) / (wordLength * .72));
    victorySentence.style.setProperty('--victory-font', `${victoryFont}cqw`);
    this.resetDwell();
    ui.victoryAim.append(ui.cursor);
    ui.board.classList.add('hidden');
    $('victoryView').classList.remove('hidden');
    document.body.dataset.view='victory';
  }

  resumeFromVictory() {
    ui.surface.append(ui.cursor);
    $('victoryView').classList.add('hidden');
    ui.board.classList.remove('hidden');
    document.body.dataset.view='board';
    this.startRound();
  }

  onPointerDown(event) {
    if (!["pointer", "rewa"].includes(this.mode) || this.completed) return;
    const point = { x: event.clientX, y: event.clientY };
    const slot = event.target.closest(".slot");
    if (this.grabbed !== null && slot) { this.releaseAt(point); return; }
    const tile = event.target.closest(".word-tile");
    if (!tile) return;
    if (this.grabbed !== null) this.cancelGrab();
    this.activePointer = { id: event.pointerId, startX: point.x, startY: point.y };
    ui.surface.setPointerCapture(event.pointerId);
    this.beginGrab(Number(tile.dataset.wordId), point);
  }

  onPointerMove(event) {
    if (!["pointer", "rewa"].includes(this.mode) || !this.activePointer || this.activePointer.id !== event.pointerId) return;
    this.moveGhost({ x: event.clientX, y: event.clientY });
  }

  onPointerUp(event) {
    if (!["pointer", "rewa"].includes(this.mode) || !this.activePointer || this.activePointer.id !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    const moved = Math.hypot(point.x - this.activePointer.startX, point.y - this.activePointer.startY) > 8;
    this.activePointer = null;
    if (ui.surface.hasPointerCapture(event.pointerId)) ui.surface.releasePointerCapture(event.pointerId);
    const target = document.elementFromPoint(point.x, point.y)?.closest(".slot");
    if (target && ui.surface.contains(target)) this.releaseAt(point);
    else if (moved) this.cancelGrab(); // A short tap keeps the tile selected for tap-to-place.
  }

  cancelPointer() {
    this.activePointer = null;
    if (this.mode === "pointer") this.cancelGrab();
  }

  resetDwell() {
    this.dwell.target?.classList.remove("dwell-target");
    this.dwell.reset();
    ui.cursor.classList.remove("counting");
  }

  updateDwell(point, now) {
    const target = this.pose === "open" && this.poseCandidate !== "fist" && this.grabbed === null
      ? document.elementFromPoint(point.x, point.y)?.closest("[data-dwell-for]") : null;
    if (this.dwellNeedsExit) {
      if (!target) this.dwellNeedsExit = false;
      return;
    }
    if (this.dwell.target !== target) this.resetDwell();
    const { progress, select } = this.dwell.update(target, now);
    ui.cursor.classList.toggle("counting", Boolean(target));
    if (!target) return;
    target.classList.add("dwell-target");
    ui.cursor.style.setProperty("--dwell-progress", progress);
    if (select) {
      this.resetDwell();
      this.dwellNeedsExit = true;
      target.click();
    }
  }

  cameraTick() {
    if (!this.cameraLoopActive) return;
    const inVictory = document.body.dataset.view === "victory";
    this.tracker.detectFrame();
    const landmarks = this.tracker.latestLandmarks;
    if (this.tracker.isTracking && landmarks) {
      const palm = landmarks[9];
      const aim = inVictory ? ui.victoryAim : ui.surface;
      const rect = aim.getBoundingClientRect();
      // A shorter vertical range lets the player reach the edges without lowering the hand as far.
      const aimY = Math.max(0, Math.min(1, (palm.y - .12) / .72));
      const point = { x: rect.left + (1 - palm.x) * rect.width, y: rect.top + aimY * rect.height };
      ui.cursor.classList.remove("hidden");
      ui.cursor.style.left = `${point.x - rect.left}px`;
      ui.cursor.style.top = `${point.y - rect.top}px`;
      this.moveGhost(point);
      ui.tracking.textContent = "Mano detectada";
      if (this.lastResultAt !== this.tracker.lastResultAt) {
        this.lastResultAt = this.tracker.lastResultAt;
        const candidate = classifyHand(landmarks);
        if (candidate === this.poseCandidate) this.poseSamples += 1;
        else { this.poseCandidate = candidate; this.poseSamples = 1; }
        if (this.poseSamples >= 2 && candidate !== "unknown" && candidate !== this.pose) {
          this.pose = candidate;
          ui.cursor.classList.toggle("fist", candidate === "fist");
          if (!inVictory) {
            if (candidate === "fist") this.beginGrabAt(point);
            else this.releaseAt(point);
          }
        }
      }
      this.updateDwell(point, performance.now());
    } else {
      this.resetDwell();
      this.dwellNeedsExit = false;
      ui.cursor.classList.add("hidden");
      ui.tracking.textContent = "Buscando mano…";
      this.pose = "unknown";
      this.poseCandidate = "unknown";
      this.poseSamples = 0;
    }
    requestAnimationFrame(() => this.cameraTick());
  }

  backToSetup() {
    this.challenge.running=false;
    this.clearEnemy();
    this.resetDwell();
    this.dwellNeedsExit = false;
    ui.surface.append(ui.cursor);
    document.body.dataset.view="menu";
    this.cameraLoopActive = false;
    this.tracker.stopCamera();
    this.tracker.isInitialized = false;
    this.lastResultAt = -1;
    this.pose = "unknown";
    this.grabbed = null;
    ui.cameraPreview.classList.add("hidden");
    ui.cursor.classList.add("hidden");
    ui.board.classList.add("hidden");
    ui.setup.classList.remove("hidden");
    window.scrollTo({top:0,behavior:"instant"});
    ui.tracking.textContent = "Cámara apagada";
    ui.tracking.classList.remove("active");
    this.renderSentences();
  }
}

export const sentenceGame = new SentenceGame();
