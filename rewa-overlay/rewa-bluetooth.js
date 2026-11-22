export const SERVICE='8c7b0001-6c19-4b45-9d44-726577610001';
export const INPUT='8c7b0002-6c19-4b45-9d44-726577610001';
const neutral=()=>({ax:0,ay:1,az:0,touch:0,tx:233,ty:233,buttons:0});
export class BluetoothInput {
 constructor(){this.reset();}
 reset(){this.seq=null;this.received=-Infinity;this.target=neutral();this.queue=[];this.digital=neutral();}
 ingest(view,time){
  if(view.byteLength!==20||view.getUint8(0)!==1)return false;
  const seq=view.getUint16(4,true),delta=this.seq===null?1:(seq-this.seq)&65535;
  if(!delta||delta>32767)return false;
  const p={touch:view.getUint8(1)&1,buttons:view.getUint8(2),ax:view.getInt16(6,true)/1000,ay:view.getInt16(8,true)/1000,az:view.getInt16(10,true)/1000,tx:view.getUint16(12,true),ty:view.getUint16(14,true)};
  if(p.tx>465||p.ty>465||Math.max(Math.abs(p.ax),Math.abs(p.ay),Math.abs(p.az))>2)return false;
  if(p.touch!==this.target.touch||p.buttons!==this.target.buttons)this.queue.push(p);
  if(this.queue.length>64)this.queue=this.queue.slice(-64);
  this.seq=seq;this.received=time;this.target=p;return true;
 }
 live(time){return time-this.received<500;}
 next(time){if(!this.live(time)){this.queue=[];return neutral();}const edge=this.queue.shift();this.digital=edge||this.target;return {...this.target,touch:this.digital.touch,buttons:this.digital.buttons,tx:this.digital.tx,ty:this.digital.ty};}
}
export class RewaBluetooth {
 constructor(onState=()=>{},bluetooth=globalThis.navigator?.bluetooth){this.bluetooth=bluetooth;this.onState=onState;this.input=new BluetoothInput();this.device=null;this.characteristic=null;this.connected=false;this.attempt=0;this.notify=e=>this.input.ingest(e.target.value,performance.now());this.lost=()=>{this.connected=false;this.input.reset();this.onState('disconnected');};}
 async connect(){
  if(!this.bluetooth)throw Error('Abre esta página en Google Chrome para conectar REWA por Bluetooth.');
  const attempt=++this.attempt;
  // Must be called inside the Connect button click: Web Bluetooth requires user activation.
  const device=await this.bluetooth.requestDevice({filters:[{services:[SERVICE]}]});
  if(attempt!==this.attempt)return;
  this.release();this.device=device;device.addEventListener('gattserverdisconnected',this.lost);this.onState('connecting');
  try{const server=await device.gatt.connect();const service=await server.getPrimaryService(SERVICE);const characteristic=await service.getCharacteristic(INPUT);
   if(attempt!==this.attempt){device.gatt.disconnect();return;}
   this.characteristic=characteristic;this.input.reset();characteristic.addEventListener('characteristicvaluechanged',this.notify);await characteristic.startNotifications();
   if(attempt!==this.attempt){device.gatt.disconnect();return;}
   this.connected=true;this.onState('connected');
  }catch(e){this.release();this.onState('disconnected');throw e;}
 }
 release(){if(this.characteristic)this.characteristic.removeEventListener('characteristicvaluechanged',this.notify);if(this.device){this.device.removeEventListener('gattserverdisconnected',this.lost);if(this.device.gatt.connected)this.device.gatt.disconnect();}this.characteristic=null;this.device=null;this.connected=false;this.input.reset();}
 disconnect(){this.attempt++;this.release();this.onState('disconnected');}
}
