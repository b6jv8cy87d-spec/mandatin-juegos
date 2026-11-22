import test from 'node:test';
import assert from 'node:assert/strict';
import { RewaMotion } from '../rewa-overlay/rewa-motion.js';
import { BluetoothInput } from '../rewa-overlay/rewa-bluetooth.js';
const p={ax:0,ay:1,az:0,touch:0,buttons:0};
function packet(seq,touch=0,ax=0){const v=new DataView(new ArrayBuffer(20));v.setUint8(0,1);v.setUint8(1,touch);v.setUint16(4,seq,true);v.setInt16(6,ax*1000,true);v.setInt16(8,1000,true);return v;}
test('stationary neutral and small noise do not move cursor',()=>{const m=new RewaMotion();assert.equal(m.step(p,.016).dx,0);assert.equal(Math.abs(m.step({...p,ax:.02,az:.02},.016).dy),0);});
test('both inversions change direction, not speed',()=>{const m=new RewaMotion();m.step(p,0);const q={...p,ax:.3,az:-.3};const a=m.step(q,.016),b=m.step(q,.016,{invertX:true,invertY:true});assert.ok(a.dx>0&&a.dy>0);assert.equal(a.dx,-b.dx);assert.equal(a.dy,-b.dy);});
test('neutral can be flat or upright; pitch remains controllable',()=>{for(const n of [p,{...p,ay:0,az:1}]){const m=new RewaMotion();m.step(n,0);const q=n.az?{...n,ay:.4}:{...n,az:-.4};assert.ok(m.step(q,.016).dy>0);}});
test('movement distance independent of 60/120Hz rendering',()=>{const go=fps=>{const m=new RewaMotion();m.step(p,0);let x=0;for(let i=0;i<fps;i++)x+=m.step({...p,ax:.3},1/fps).dx;return x;};assert.ok(Math.abs(go(60)-go(120))<1e-8);});
test('held touch on connect ignored; next touch fires exactly once',()=>{const m=new RewaMotion();assert.equal(m.step({...p,touch:1},.016).tap,false);m.step(p,.016);assert.equal(m.step({...p,touch:1},.016).tap,true);assert.equal(m.step({...p,touch:1},.016).tap,false);m.reset();assert.equal(m.step({...p,touch:1},.016).tap,false);});
test('short taps preserved while latest analog bypasses queue; stale input neutral',()=>{const b=new BluetoothInput();b.ingest(packet(65534),0);b.ingest(packet(65535,1,.2),1);b.ingest(packet(0,0,.4),2);assert.equal(b.next(3).touch,1);assert.equal(b.next(4).touch,0);assert.equal(b.target.ax,.4);assert.equal(b.ingest(packet(65535),5),false);assert.equal(b.live(600),false);assert.equal(b.next(600).touch,0);assert.equal(b.next(600).ax,0);});
