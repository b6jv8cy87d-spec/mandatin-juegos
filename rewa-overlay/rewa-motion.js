// Motion and tap state are independent of the DOM so transport bursts and frame rates
// can be tested. Latest analog sample + queued digital edges, no polling or network.
export class RewaMotion {
  constructor() { this.reset(); }
  reset() { this.neutral=null; this.armed=false; this.touch=0; this.buttons=0; }
  center(p) {
    const length=Math.hypot(p.ay,p.az);
    if(length<.25)return false;
    this.neutral={ax:p.ax,ay:p.ay/length,az:p.az/length};
    return true;
  }
  step(p,dt,{invertX=false,invertY=false,speed=650}={}) {
    if(!this.neutral)this.center(p);
    const n=this.neutral;
    const curve=v=>Math.sign(v)*Math.min(1,Math.max(0,Math.abs(v)-.045)/.42);
    // Tangent to gravity works both with an upright screen and a face-up device.
    const vx=n?curve(p.ax-n.ax)*(invertX?-1:1):0;
    const vy=n?curve(n.az*p.ay-n.ay*p.az)*(invertY?-1:1):0;
    const tap=this.armed && !!p.touch && !this.touch;
    const center=this.armed && !!(p.buttons&2) && !(this.buttons&2);
    if(!p.touch && !p.buttons)this.armed=true;
    this.touch=p.touch;this.buttons=p.buttons;
    const seconds=Math.min(.04,Math.max(0,dt));
    return {dx:vx*speed*seconds,dy:vy*speed*seconds,tap,center};
  }
}
