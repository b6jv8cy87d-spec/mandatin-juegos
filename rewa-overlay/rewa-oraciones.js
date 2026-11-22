import { RewaBluetooth } from './rewa-bluetooth.js?v=rewa1';
import { RewaMotion } from './rewa-motion.js?v=rewa1';
const $=id=>document.getElementById(id);
export class RewaOraciones {
  constructor(game) {
    this.game=game;this.motion=new RewaMotion();this.point={x:0,y:0};this.last=null;this.wasLive=false;
    this.ble=new RewaBluetooth(state=>this.state(state));
    this.cursor=document.createElement('div');this.cursor.id='rewaCursor';this.cursor.hidden=true;
    this.cursor.setAttribute('aria-hidden','true');document.body.append(this.cursor);
    this.connectButton=$('rewaConnect');this.status=$('rewaStatus');
    this.connectButton.addEventListener('click',()=>this.connect());
    $('rewaDisconnect').addEventListener('click',()=>this.ble.disconnect());
    $('rewaCenter').addEventListener('click',()=>this.center());
    for(const [id,key] of [['rewaInvert','x'],['rewaInvertY','y']]) {
      try{$(id).checked=localStorage.getItem('mandatin-oraciones-rewa-invert-'+key)==='1';}catch{}
      $(id).addEventListener('change',()=>{try{localStorage.setItem('mandatin-oraciones-rewa-invert-'+key,$(id).checked?'1':'0');}catch{}});
    }
    $('startRewaBtn').addEventListener('click',()=>{
      if(!game.sentences.length)return;
      game.cameraLoopActive=false;game.tracker.stopCamera();game.tracker.isInitialized=false;
      $('cameraPreview').classList.add('hidden');
      game.start('rewa');this.center();
    });
    document.addEventListener('visibilitychange',()=>{
      this.motion.reset();this.wasLive=false;this.last=null;
      // Discard queued taps accumulated before or during a background tab.
      this.ble.input.reset();this.clearTarget();
      if(game.mode==='rewa'&&game.grabbed!==null)game.cancelGrab();
    });
    window.addEventListener('pagehide',()=>this.ble.disconnect());
    window.addEventListener('resize',()=>this.center());
    this.state('disconnected');
  }
  ready(now=performance.now()) {return this.ble.connected&&this.ble.input.live(now)&&!document.hidden;}
  state(state) {
    const connected=state==='connected';
    this.connectButton.hidden=connected;
    $('rewaLabel').textContent=connected?'REWA conectado':'Control REWA';
    $('rewaDisconnect').hidden=$('rewaCenter').hidden=!connected;
    $('startRewaBtn').disabled=!connected;
    this.status.textContent=connected?'REWA conectado · mantenlo cómodo y pulsa Centrar':state==='connecting'?'Conectando…':'En REWA: Herramientas → Control de juegos';
    if(!connected){this.motion.reset();this.wasLive=false;this.cursor.hidden=true;this.clearTarget();if(this.game.mode==='rewa'&&this.game.grabbed!==null)this.game.cancelGrab();}
  }
  async connect() {
    this.connectButton.disabled=true;
    try {await this.ble.connect();}
    catch(e){this.status.textContent=e.name==='NotFoundError'?'Conexión cancelada. Puedes intentarlo de nuevo.':e.message;}
    finally{this.connectButton.disabled=false;}
  }
  center() {
    const stage=document.body.dataset.view==='victory'?$('victoryView'):$('boardView');
    const r=stage.getBoundingClientRect();
    this.point={x:r.width?r.left+r.width/2:innerWidth/2,y:r.height?r.top+r.height/2:innerHeight/2};
    this.motion.reset();
    this.ble.input.queue=[];
    if(this.ready())this.motion.center(this.ble.input.target);
    this.clearTarget();
  }
  clearTarget(){this.target?.classList.remove('rewa-target');this.target=null;}
  targetAt(point) {
    const root=document.body.dataset.view==='victory'?$('victoryView'):$('boardView');
    const direct=document.elementFromPoint(point.x,point.y)?.closest('button,.slot,.word-tile');
    if(direct && (root.contains(direct)||$('rewaDock').contains(direct))&&!direct.disabled)return direct;
    // Expand the word/slot hit area slightly, without moving the pointer or snapping
    // to another word while carrying one. Buttons still need a deliberate aim.
    const selector=this.game.grabbed===null?'.word-tile':'.slot';
    let closest=null,best=25;
    for(const el of root.querySelectorAll(selector)) {
      const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
      const d=Math.hypot(Math.max(r.left-point.x,0,point.x-r.right),Math.max(r.top-point.y,0,point.y-r.bottom));
      if(d<best){best=d;closest=el;}
    }
    return closest;
  }
  activate(target) {
    if(!target)return;
    if(target.matches('button')&&!target.matches('.word-tile')){target.click();return;}
    const g=this.game,r=target.getBoundingClientRect(),p={x:r.left+r.width/2,y:r.top+r.height/2};
    if(g.grabbed!==null){if(target.closest('.slot'))g.releaseAt(p);}
    else if(target.matches('.word-tile')){
      g.beginGrab(Number(target.dataset.wordId),p);
      $('feedback').textContent=`Lleva «${g.words[g.grabbed]}» a un espacio y toca REWA para soltarla.`;
    }
  }
  tick(now) {
    const dt=this.last===null?0:(now-this.last)/1000;this.last=now;
    const active=this.game.mode==='rewa'&&['board','victory'].includes(document.body.dataset.view);
    const live=this.ready(now);
    this.cursor.hidden=!active||!live;
    if(!active||!live) {
      if(this.wasLive&&!live){this.motion.reset();this.clearTarget();if(this.game.mode==='rewa'&&this.game.grabbed!==null)this.game.cancelGrab();}
      this.wasLive=false;return;
    }
    if(!this.wasLive){this.center();this.motion.reset();this.wasLive=true;}
    const p=this.ble.input.next(now),motion=this.motion.step(p,dt,{invertX:$('rewaInvert').checked,invertY:$('rewaInvertY').checked,speed:Math.min(innerWidth,innerHeight)*.95});
    if(motion.center)this.center();
    this.point.x=Math.max(12,Math.min(innerWidth-12,this.point.x+motion.dx));
    this.point.y=Math.max(12,Math.min(innerHeight-12,this.point.y+motion.dy));
    this.cursor.style.transform=`translate3d(${this.point.x}px,${this.point.y}px,0)`;
    this.cursor.classList.toggle('holding',this.game.grabbed!==null);
    this.game.moveGhost(this.point);
    const target=this.targetAt(this.point);
    if(target!==this.target){this.clearTarget();this.target=target;target?.classList.add('rewa-target');}
    if(motion.tap)this.activate(target);
  }
}
