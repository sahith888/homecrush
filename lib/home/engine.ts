import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROOMS, type House, type RoomId, type RoomConfig } from './schema';

type Box = {minX:number;maxX:number;minZ:number;maxZ:number;floor:number};
type Events = { onRoom:(room:RoomId)=>void;onFloor:(floor:number)=>void;onWalk:(active:boolean)=>void;onReady:()=>void;onError:(text:string)=>void;onPosition:(x:number,z:number)=>void };
export class HouseEngine {
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(52,1,.08,120);
  renderer:THREE.WebGLRenderer; controls:OrbitControls; root=new THREE.Group();
  floors=[new THREE.Group(),new THREE.Group()]; walls:THREE.Object3D[]=[]; ceiling=new THREE.Group();
  colliders:Box[]=[]; house:House; floor=0; walking=false; whole=false; blueprint=false;
  keys=new Set<string>(); lookYaw=0; lookPitch=0; footY=0; pointerDown=false; lastX=0;lastY=0;
  player=new THREE.Vector3(-4.3,1.65,4); clock=new THREE.Clock(); frame=0; disposed=false;
  sun=new THREE.DirectionalLight('#fff2d8',3.2); ambient=new THREE.HemisphereLight('#f2f5ff','#aea391',2.3);
  avatar=new THREE.Group(); marker=new THREE.Group(); resize:ResizeObserver; container:HTMLElement;
  events:Events; lastRoom:RoomId='living'; pointerLocked=false; materialCache=new Map<string,THREE.Material>(); textures:THREE.Texture[]=[];
  modeListener=()=>{this.pointerLocked=document.pointerLockElement===this.renderer.domElement;};
  downListener=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.matches('input,textarea,select'))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft'].includes(e.code)){this.keys.add(e.code);if(this.walking)e.preventDefault();}if(e.code==='Escape'&&this.walking)this.setWalk(false);};
  upListener=(e:KeyboardEvent)=>this.keys.delete(e.code);
  blurListener=()=>this.keys.clear();
  constructor(container:HTMLElement,house:House,events:Events){
    this.container=container;this.house=house;this.events=events;
    try{this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});}catch{throw new Error('Your browser could not start 3D graphics. Enable WebGL and reload.');}
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
    this.renderer.domElement.setAttribute('aria-label','Interactive two-floor dream home. Use Walk inside, then W A S D to move and drag to look.');
    container.appendChild(this.renderer.domElement);
    this.scene.background=new THREE.Color('#e5e9df');this.scene.fog=new THREE.Fog('#e5e9df',45,85);
    this.camera.position.set(17,16,21);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,0,0);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.minDistance=12;this.controls.maxDistance=65;this.controls.maxPolarAngle=Math.PI*.43;this.controls.minPolarAngle=.2;this.controls.enablePan=true;
    this.scene.add(this.ambient);this.sun.position.set(-10,20,10);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.left=-22;this.sun.shadow.camera.right=22;this.sun.shadow.camera.top=22;this.sun.shadow.camera.bottom=-22;this.sun.shadow.normalBias=.025;this.sun.shadow.bias=-.0004;this.scene.add(this.sun);
    this.scene.add(this.root);this.environment();this.build();
    this.renderer.domElement.addEventListener('pointerdown',this.onPointerDown);this.renderer.domElement.addEventListener('pointermove',this.onPointerMove);window.addEventListener('pointerup',this.onPointerUp);
    window.addEventListener('keydown',this.downListener);window.addEventListener('keyup',this.upListener);window.addEventListener('blur',this.blurListener);document.addEventListener('pointerlockchange',this.modeListener);
    this.resize=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;this.camera.aspect=w/Math.max(1,h);this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);if(!this.walking){const scale=Math.max(1,Math.min(1.9,.95/this.camera.aspect));this.camera.position.set(this.controls.target.x+17*scale,this.controls.target.y+16*scale,this.controls.target.z+21*scale);}});this.resize.observe(container);
    this.animate();events.onReady();
  }
  mat(color:string,roughness=.8,metalness=0){const key=color+roughness+metalness;if(!this.materialCache.has(key))this.materialCache.set(key,new THREE.MeshStandardMaterial({color,roughness,metalness}));return this.materialCache.get(key)!;}
  box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:string,cast=true){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),this.mat(color));m.position.set(x,y,z);m.castShadow=cast;m.receiveShadow=true;parent.add(m);return m;}
  cyl(parent:THREE.Object3D,x:number,y:number,z:number,r:number,h:number,color:string,rTop=r){const m=new THREE.Mesh(new THREE.CylinderGeometry(rTop,r,h,24),this.mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  ball(parent:THREE.Object3D,x:number,y:number,z:number,r:number,color:string,sx=1,sy=1,sz=1){const m=new THREE.Mesh(new THREE.SphereGeometry(r,16,12),this.mat(color));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m;}
  collision(x:number,z:number,w:number,d:number,floor:number){this.colliders.push({minX:x-w/2-.22,maxX:x+w/2+.22,minZ:z-d/2-.22,maxZ:z+d/2+.22,floor});}
  floorTexture(c:RoomConfig){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d')!;ctx.fillStyle=c.floorColor;ctx.fillRect(0,0,512,512);
    let seed=19;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
    if(c.floorKind==='oak'||c.floorKind==='walnut'){
      for(let x=0;x<512;x+=64){ctx.fillStyle=`rgba(40,25,10,${rand()*.08})`;ctx.fillRect(x,0,63,512);ctx.fillStyle='rgba(40,25,10,.12)';ctx.fillRect(x,0,1,512);for(let i=0;i<85;i++){ctx.strokeStyle=`rgba(65,37,14,${rand()*.1})`;ctx.beginPath();const xx=x+rand()*62;const yy=rand()*512;ctx.moveTo(xx,yy);ctx.bezierCurveTo(xx+4,yy+20,xx-3,yy+55,xx+1,yy+130);ctx.stroke();}ctx.fillStyle='rgba(30,20,10,.15)';ctx.fillRect(x,(x/64%2)*210+120,64,1);}
    }else{ctx.strokeStyle='rgba(255,255,255,.45)';ctx.lineWidth=2;for(let x=0;x<512;x+=128){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,512);ctx.stroke();ctx.beginPath();ctx.moveTo(0,x);ctx.lineTo(512,x);ctx.stroke();}}
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,2);t.anisotropy=4;this.textures.push(t);return t;
  }
  environment(){
    const ground=this.box(this.scene,0,-.4,0,100,.2,100,'#c9d3bc',false);ground.receiveShadow=true;
    this.box(this.scene,0,-.17,0,18,.25,14,'#d9d5c6');this.box(this.scene,0,-.03,7.6,7,.08,2.6,'#d9d5c6');
    for(let i=0;i<7;i++)this.box(this.scene,0,-.25,10+i*1.3,2,.1,.85,'#f1eee4');
    for(const side of [-1,1])for(let i=0;i<5;i++){const x=side*(12+(i%2)*2),z=-10+i*5;this.cyl(this.scene,x,1,z,.15,2,'#8e7656');this.ball(this.scene,x,3.1,z,1.5,'#8caa7a',1,1.25,1);this.ball(this.scene,x-.6,2.5,z+.5,.9,'#9eb88c');}
    for(let i=0;i<18;i++){const x=-10+i*1.15;this.ball(this.scene,x,.4,-9,.65,i%2?'#7f9a68':'#8ca778',1,.65,1);}
    const pad=this.cyl(this.scene,10.5,-.05,7,1.8,.12,'#b7c4aa');pad.receiveShadow=true;
  }
  disposeGroup(group:THREE.Object3D){group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});group.clear();}
  build(){
    this.disposeGroup(this.root);this.textures.forEach(t=>t.dispose());this.textures=[];this.walls=[];this.colliders=[];this.floors=[new THREE.Group(),new THREE.Group()];this.ceiling=new THREE.Group();
    for(let f=0;f<2;f++){
      const g=this.floors[f];g.position.y=f*3.3;this.root.add(g);
      // Upper floor contains a real open stairwell.
      if(f===0)this.box(g,0,-.1,0,16,.2,12,'#eee9de');
      else {this.box(g,-3.65,-.1,0,8.7,.2,12,'#eee9de');this.box(g,5.45,-.1,0,5.1,.2,12,'#eee9de');this.box(g,1.8,-.1,-4.5,2.2,.2,3,'#eee9de');this.box(g,1.8,-.1,4.2,2.2,.2,3.6,'#eee9de');}
      for(const [id,info] of Object.entries(ROOMS))if(info.floor===f&&id!=='hallway'&&id!=='upperHallway'){const c=this.house.rooms[id as RoomId];const mesh=new THREE.Mesh(new THREE.BoxGeometry(info.width,.035,info.depth),new THREE.MeshStandardMaterial({map:this.floorTexture(c),roughness:.87}));mesh.position.set(info.x,.01,info.z);mesh.receiveShadow=true;g.add(mesh);this.furnish(g,id as RoomId,c);}
      this.architecture(g,f);this.decorHall(g,f);
    }
    this.staircase(this.floors[0]);this.guide(this.floors[0]);this.root.add(this.ceiling);this.box(this.ceiling,0,6.25,0,16,.16,12,'#efede4');
    this.updateLighting();this.updateVisibility();
  }
  wall(parent:THREE.Object3D,x:number,z:number,w:number,d:number,color:string,f:number,exterior=false){const m=this.box(parent,x,1.42,z,w,2.84,d,color);this.collision(x,z,w,d,f);if(exterior){m.userData.cutaway=true;this.walls.push(m);}this.box(parent,x,.08,z,w+.015,.14,d+.015,'#f5f0e5');return m;}
  doorWall(parent:THREE.Object3D,axis:'x'|'z',pos:number,min:number,max:number,door:number,width:number,color:string,f:number){
    const a=door-width/2,b=door+width/2;
    if(axis==='x'){if(a>min)this.wall(parent,(min+a)/2,pos,a-min,.16,color,f);if(max>b)this.wall(parent,(b+max)/2,pos,max-b,.16,color,f);this.box(parent,door,2.6,pos,width,.48,.16,color);}
    else{if(a>min)this.wall(parent,pos,(min+a)/2,.16,a-min,color,f);if(max>b)this.wall(parent,pos,(b+max)/2,.16,max-b,color,f);this.box(parent,pos,2.6,door,.16,.48,width,color);}
  }
  windowWall(parent:THREE.Object3D,x:number,z:number,width:number,c:RoomConfig,f:number,side=false,front=false){
    const group=new THREE.Group();group.position.set(x,0,z);if(side)group.rotation.y=Math.PI/2;parent.add(group);
    const opening=c.windows==='tall'?width*.73:width*.45;const base=c.windows==='tall'?.38:1.0;const top=2.5;const piece=(width-opening)/2;
    this.box(group,-(width+opening)/4,1.42,0,piece,2.84,.2,c.wall);this.box(group,(width+opening)/4,1.42,0,piece,2.84,.2,c.wall);this.box(group,0,base/2,0,opening,base,.2,c.wall);this.box(group,0,(top+2.84)/2,0,opening,2.84-top,.2,c.wall);
    this.box(group,0,base,0,opening+.13,.08,.28,'#faf5e8');this.box(group,0,top,0,opening+.13,.08,.22,'#faf5e8');
    for(const xx of [-opening/2,0,opening/2])this.box(group,xx,(top+base)/2,0,.065,top-base,.14,'#eae5d8');
    const glass=new THREE.Mesh(new THREE.BoxGeometry(opening,top-base,.025),new THREE.MeshStandardMaterial({color:'#cae4e1',transparent:true,opacity:.22,roughness:.12,metalness:.05}));glass.position.set(0,(top+base)/2,0);group.add(glass);
    if(front){group.userData.cutaway=true;this.walls.push(group);}this.collision(x,z,side?.2:width,side?width:.2,f);
  }
  architecture(g:THREE.Group,f:number){
    const left=f===0?this.house.rooms.living:this.house.rooms.bedroom;const back=f===0?this.house.rooms.kitchen:this.house.rooms.guest;const right=f===0?this.house.rooms.studio:this.house.rooms.bathroom;const hall=f===0?this.house.rooms.hallway:this.house.rooms.upperHallway;
    this.windowWall(g,-4.25,-6,7.5,back,f);this.wall(g,1.4,-6,3.8,.2,hall.wall,f);this.windowWall(g,5.55,-6,4.9,right,f);
    this.windowWall(g,-8,3,6,left,f,true);this.windowWall(g,-8,-3,6,back,f,true);
    this.windowWall(g,8,3,6,right,f,true,true);this.windowWall(g,8,-3,6,right,f,true,true);
    this.windowWall(g,-4.25,6,7.5,left,f,false,true);this.windowWall(g,5.55,6,4.9,right,f,false,true);const fw=new THREE.Group();g.add(fw);this.doorWall(fw,'x',6,-.5,3.1,1.3,1.8,hall.wall,f);this.walls.push(fw);
    this.doorWall(g,'x',0,-8,-.5,-4.4,2.1,left.wall,f);
    this.doorWall(g,'z',-.5,0,6,2.8,1.8,left.wall,f);this.doorWall(g,'z',-.5,-6,0,-3.7,1.8,back.wall,f);
    this.doorWall(g,'z',3.1,-6,6,3.8,1.8,right.wall,f);
    // Side rail guards the upstairs stairwell while leaving its landings open.
    if(f===1){for(const x of [.72,2.92]){for(let z=-2.8;z<2.5;z+=.6)this.cyl(g,x,.5,z,.025,1,'#8a7a62');this.box(g,x,1.02,-.15,.06,.06,5.5,'#8a7a62');}}
  }
  legs(g:THREE.Object3D,x:number,z:number,w:number,d:number,h:number,color='#8b6848'){for(const xx of [-1,1])for(const zz of [-1,1])this.cyl(g,x+xx*w/2,h/2,z+zz*d/2,.045,h,color);}
  rug(g:THREE.Object3D,x:number,z:number,w:number,d:number,color='#d4c6ac'){this.box(g,x,.055,z,w,.035,d,color,false);for(const side of [-1,1])for(let i=0;i<22;i++)this.box(g,x-w/2+i*w/22,.06,z+side*(d/2+.05),.02,.015,.15,'#e9ddc4',false);}
  plant(g:THREE.Object3D,x:number,z:number,size=1){this.cyl(g,x,.23*size,z,.2*size,.46*size,'#c9af8d',.27*size);this.cyl(g,x,.8*size,z,.024,1.15*size,'#67754a');for(let i=0;i<7;i++){const a=i*2.399;this.ball(g,x+Math.cos(a)*.22*size,(.75+i*.11)*size,z+Math.sin(a)*.22*size,.23*size,i%2?'#80966c':'#5e7b50',1.3,.45,.9);}}
  art(g:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,accent:string,side=false){const a=new THREE.Group();a.position.set(x,y,z);if(side)a.rotation.y=Math.PI/2;g.add(a);this.box(a,0,0,0,w,h,.07,'#987a57');this.box(a,0,0,.05,w-.12,h-.12,.02,'#eee8db');this.ball(a,0,-.02,.09,w*.24,accent,1,1.2,.03);this.box(a,0,-h*.25,.1,w*.65,.04,.02,'#ba9a74');}
  sofa(g:THREE.Object3D,x:number,z:number,c:RoomConfig){this.box(g,x,.36,z,3.1,.42,1.05,c.accent);this.box(g,x,.72,z-.48,3.1,.85,.2,c.accent);for(const s of [-1,1]){this.box(g,x+s*1.48,.58,z,.18,.67,1.2,c.accent);this.box(g,x+s*.68,.61,z+.06,1.35,.2,.95,c.accent);const cushion=this.box(g,x+s*.98,.88,z-.2,.48,.46,.16,s===1?'#d6b18b':'#eee4cf');cushion.rotation.z=s*.14;}this.legs(g,x,z,2.6,.8,.22);}
  lamp(g:THREE.Object3D,x:number,z:number,lighting:RoomConfig['lighting']='neutral'){this.cyl(g,x,.04,z,.23,.07,'#635d50');this.cyl(g,x,.9,z,.025,1.8,'#9d835c');const shade=this.cyl(g,x,1.75,z,.3,.42,'#eee0bd',.22);const tint=lighting==='warm'?'#ffd18c':lighting==='cool'?'#c5dfff':'#fff0ce';shade.material=new THREE.MeshStandardMaterial({color:'#eee0bd',emissive:tint,emissiveIntensity:lighting==='warm'?.7:.25,roughness:.7});const light=new THREE.PointLight(tint,lighting==='warm'?18:12,7,2);light.position.set(x,1.7,z);g.add(light);}
  bed(g:THREE.Object3D,x:number,z:number,c:RoomConfig,w=2.7){this.box(g,x,.28,z,w,.45,3.4,'#9a7758');this.box(g,x,.58,z,w-.05,.24,3.25,'#f5f0df');this.box(g,x,.74,z+.45,w,.13,2.1,c.accent);this.box(g,x,1.02,z-1.65,w+.2,1.65,.16,c.accent);for(const s of [-1,1]){this.box(g,x+s*w*.24,.8,z-1.05,w*.4,.2,.65,'#faf4e7');this.box(g,x+s*(w/2+.5),.37,z-1.13,.65,.74,.65,'#b59b76');this.cyl(g,x+s*(w/2+.5),.98,z-1.13,.16,.35,'#e6d3ac',.12);}}
  furnish(g:THREE.Group,id:RoomId,c:RoomConfig){
    const r=ROOMS[id];const f=r.floor;
    if(c.rug)this.rug(g,r.x,r.z,Math.min(r.width-1,4.8),3.3,c.style==='coastal'?'#c7d7d2':'#dfd1b6');
    if(c.furniture){
      if(id==='living'){
        this.sofa(g,-4.5,1.45,c);this.collision(-4.5,1.45,3.2,1.25,f);
        this.cyl(g,-4.3,.42,3.4,.78,.12,'#9b7651');this.cyl(g,-4.3,.2,3.4,.2,.4,'#9b7651');this.collision(-4.3,3.4,1.3,1.3,f);
        this.cyl(g,-4.65,.55,3.4,.13,.17,'#e9ddc6');this.box(g,-4.1,.5,3.45,.38,.03,.3,'#7e8b71');
        this.box(g,-7.4,.4,3.4,.6,.8,2.3,'#b39670');this.art(g,-7.85,1.7,3.2,1.6,1.2,c.accent,true);
        this.cyl(g,-1.7,.43,4.9,.55,.7,'#b29571');this.ball(g,-1.7,.86,4.9,.57,'#cab998',1,.25,1);this.collision(-1.7,4.9,1.1,1.1,f);
      }
      if(id==='kitchen'){
        this.box(g,-4.7,.46,-5.43,5.5,.92,.88,c.cabinet);this.box(g,-4.7,.96,-5.43,5.65,.1,1.02,'#e8e5d9');
        for(let x=-7;x<-2;x+=.83){this.box(g,x,.5,-4.975,.015,.7,.02,'#7c856e');this.box(g,x+.24,.74,-4.96,.2,.025,.02,'#7f725c');}
        this.box(g,-6.3,1.02,-5.4,1.1,.04,.6,'#83918e');this.cyl(g,-6.3,1.2,-5.65,.035,.4,'#909895');
        this.box(g,-2.9,1.03,-5.4,1.15,.04,.7,'#3f4947');for(const x of [-3.2,-2.6])for(const z of [-5.6,-5.2])this.cyl(g,x,1.06,z,.16,.02,'#6c7772');
        this.collision(-4.7,-5.43,5.65,1.02,f);
        if(c.island){this.box(g,-4.8,.47,-2.8,2.5,.94,1.15,c.cabinet);this.box(g,-4.8,.98,-2.8,2.75,.1,1.35,'#e6dfcc');this.collision(-4.8,-2.8,2.75,1.35,f);for(const x of [-5.5,-4.2]){this.cyl(g,x,.6,-1.7,.3,.12,'#ba9470');this.legs(g,x,-1.7,.38,.38,.55);}this.cyl(g,-4.8,1.14,-2.8,.22,.21,'#d4b58b',.28);}
        this.art(g,-7.87,1.75,-2.9,1.2,1.4,'#bc8a64',true);
      }
      if(id==='studio'){
        this.box(g,6.9,.8,-2.8,1.2,.1,3.5,'#bb9a72');this.legs(g,6.9,-2.8,.8,3.1,.78);this.collision(6.9,-2.8,1.25,3.5,f);
        const monitor=this.box(g,7.1,1.35,-2.8,.08,.8,1.3,'#424d47');this.box(g,7.04,1.35,-2.8,.02,.68,1.14,'#94b0a6');this.cyl(g,5.75,.48,-2.8,.4,.1,c.accent);this.cyl(g,5.75,.24,-2.8,.06,.48,'#81755f');
        this.box(g,6.6,.38,4.7,2.1,.55,1.1,c.accent);this.box(g,6.6,.9,5.15,2.1,.8,.18,c.accent);this.collision(6.6,4.7,2.1,1.2,f);
        this.box(g,5.5,1.25,-5.75,3.1,2.5,.25,'#b79b74');for(let y=.3;y<2.5;y+=.6){this.box(g,5.5,y,-5.5,3.1,.06,.55,'#c7ae89');for(let i=0;i<6;i++)this.box(g,4.4+i*.35,y+.2,-5.48,.18,.35+(i%2)*.1,.3,['#889b78','#bf997d','#d0bd9b'][i%3]);}
        this.art(g,7.85,1.8,2,1.5,1.5,c.accent,true);
      }
      if(id==='bedroom'||id==='guest'){
        const z=id==='bedroom'?2.25:-3.5;this.bed(g,-4.5,z,c,id==='guest'?2.25:2.75);this.collision(-4.5,z,2.8,3.5,f);
        this.box(g,-7.5,1.05,z,.55,2.1,2.8,c.cabinet);this.collision(-7.5,z,.65,2.8,f);
        this.art(g,-4.5,1.9,id==='bedroom'?.11:-5.87,1.4,.8,c.accent);
      }
      if(id==='bathroom'){
        this.box(g,6.1,.35,-3.6,2.4,.7,1.5,'#eeeee5');this.box(g,6.1,.72,-3.6,2.15,.1,1.25,'#c8d9d2');this.box(g,6.1,.76,-3.6,1.9,.06,1.02,'#a7c5be');this.collision(6.1,-3.6,2.5,1.6,f);
        this.cyl(g,7.45,.6,-3.6,.04,1.2,'#b69c64');this.box(g,7.25,1.2,-3.6,.45,.07,.07,'#b69c64');
        this.box(g,7.35,.45,1.1,.9,.9,3,c.cabinet);this.box(g,7.35,.96,1.1,1,.1,3.1,'#e8e7dc');this.collision(7.35,1.1,1,3.1,f);
        for(const z of [.3,1.9]){this.cyl(g,7.25,1.08,z,.3,.16,'#f7f5e9');this.box(g,7.87,1.8,z,.04,1.05,1.05,'#b7c9bd');}
        this.rug(g,5.5,1,1.3,2.4,'#d0c7b3');this.cyl(g,4.4,.3,4.8,.37,.6,'#bda67e');
      }
    }
    const plantSpots=id==='living'?[[-7,5.2],[-1.2,1],[-6.6,1],[-1.2,5.2],[-7,2]]:id==='kitchen'?[[-1.3,-5],[-7,-.8],[-1.3,-1],[-6.9,-4],[-2,-4]]:id==='bedroom'?[[-1.3,1],[-7,5.3],[-1.3,5.3],[-6.8,.8],[-1.4,3.6]]:id==='guest'?[[-1.3,-5.2],[-6.8,-.8],[-1.3,-1],[-6.8,-4.8],[-2,-4]]:[[4,-5],[7,5.3],[4,1],[4.3,5.2],[7,-.5]];
    for(let i=0;i<c.plants;i++)this.plant(g,plantSpots[i][0],plantSpots[i][1],i%2?.8:1);
    if(c.lamp)this.lamp(g,id==='studio'||id==='bathroom'?4.2:-1.3,id==='kitchen'||id==='guest'?-1:4.5,c.lighting);
    if(c.decor==='layered'){const wallZ=id==='living'||id==='bedroom'?.12:-5.86;this.art(g,r.x-2,1.8,wallZ,.6,.9,c.accent);this.art(g,r.x-1.2,1.65,wallZ,.55,.65,'#c1a179');}
  }
  decorHall(g:THREE.Group,f:number){
    const c=f===0?this.house.rooms.hallway:this.house.rooms.upperHallway;
    const floorMat=new THREE.MeshStandardMaterial({map:this.floorTexture(c),roughness:.9});
    for(const [x,z,w,d] of [[1.3,4.4,3.2,2.8],[1.3,-4.5,3.2,2.8],[.14,-.2,.75,6]]){const slab=new THREE.Mesh(new THREE.BoxGeometry(w,.03,d),floorMat);slab.position.set(x,.02,z);slab.receiveShadow=true;g.add(slab);}
    if(c.rug)this.rug(g,1.3,4.6,2.4,1.7,c.accent);
    this.art(g,1.4,1.7,-5.87,1.2,1.1,c.accent);
    const spots=[[2.65,5.25],[2.65,-5.15],[-.02,5.3],[-.02,-5.2],[2.65,-4.5]];
    for(let i=0;i<c.plants;i++)this.plant(g,spots[i][0],spots[i][1],.65);
    if(c.lamp)this.lamp(g,2.65,5.1,c.lighting);
    if(c.decor==='layered'){
      this.box(g,1.4,.75,-5.6,1.7,.08,.4,c.cabinet);this.legs(g,1.4,-5.6,1.5,.28,.72);
      this.cyl(g,1,.91,-5.6,.12,.26,'#ba8868',.09);
      for(let i=0;i<3;i++)this.box(g,1.6,.81+i*.04,-5.6,.32,.035,.24,['#829271','#d6b68b','#b77b5b'][i]);
      this.art(g,.15,1.65,-5.87,.48,.72,'#c6a276');this.art(g,2.55,1.9,-5.87,.48,.62,c.accent);
    }
  }
  staircase(g:THREE.Group){
    for(let i=0;i<19;i++){const h=(i+1)*3.3/19;const z=2.4-(i+.5)*5.4/19;this.box(g,1.8,h/2,z,2,h,5.4/19+.01,'#b89a72');this.box(g,1.8,h+.015,z,2.08,.035,5.4/19+.03,'#cfb490');}
    for(const x of [.72,2.92]){for(let i=0;i<10;i++){const z=2.4-i*.6,h=i/9*3.3;this.cyl(g,x,h+.47,z,.022,.94,'#81765f');}const rail=this.box(g,x,2.13,-.3,.055,.055,6.35,'#81765f');rail.rotation.x=.548;}
  }
  guide(g:THREE.Group){
    const a=new THREE.Group();a.position.set(.15,0,4.5);g.add(a);this.avatar=a;
    this.cyl(a,0,.63,0,.2,.65,'#617c69',.26);this.ball(a,0,1.18,0,.22,'#d5ad89');this.ball(a,0,1.28,-.04,.23,'#55483d',1,.65,1);
    for(const s of [-1,1]){this.box(a,s*.12,.2,0,.13,.4,.15,'#bbaa89');const arm=this.box(a,s*.3,.72,0,.1,.5,.12,'#617c69');arm.rotation.z=s*.15;this.ball(a,s*.075,1.19,.195,.018,'#383e36');}
    const ring=new THREE.Mesh(new THREE.RingGeometry(.34,.39,36),new THREE.MeshBasicMaterial({color:'#668275',side:THREE.DoubleSide,transparent:true,opacity:.5}));ring.rotation.x=-Math.PI/2;ring.position.y=.03;a.add(ring);
  }
  updateVisibility(){
    for(let i=0;i<2;i++)this.floors[i].visible=this.walking||this.whole||this.floor===i;
    this.walls.forEach(w=>w.visible=this.walking||this.whole);this.ceiling.visible=this.walking;
    this.scene.traverse(o=>{if(o instanceof THREE.Mesh&&o.material instanceof THREE.MeshStandardMaterial){o.material.wireframe=this.blueprint;}});
  }
  updateLighting(){const t=this.house.time;this.sun.color.set(t==='golden'?'#ffbe78':t==='night'?'#a5bbeb':'#fff4dc');this.sun.intensity=t==='night'?.7:t==='golden'?2.3:3.2;this.ambient.intensity=t==='night'?1.4:2.3;this.scene.background=new THREE.Color(t==='night'?'#66777a':t==='golden'?'#e8dfce':'#e5e9df');(this.scene.fog as THREE.Fog).color.copy(this.scene.background);}
  update(house:House){this.house=house;this.build();if(this.walking){const room=ROOMS[this.lastRoom];if(this.isBlocked(this.player.x,this.player.z,room.floor)){this.player.set(room.floor===0?-4.4:-1.5,room.floor*3.3+1.65,room.floor===0?4.8:4.8);this.footY=room.floor*3.3;}}}
  setFloor(f:number){this.floor=f;this.whole=false;if(ROOMS[this.lastRoom].floor!==f){this.lastRoom=f===0?'living':'bedroom';this.events.onRoom(this.lastRoom);}if(this.walking){this.player.set(.1,f*3.3+1.65,-4.6);this.footY=f*3.3;this.lookYaw=Math.PI;}else{this.controls.target.set(0,f*3.3,0);this.fitView();}this.updateVisibility();this.events.onFloor(f);}
  focusRoom(room:RoomId){const r=ROOMS[room];this.lastRoom=room;this.floor=r.floor;this.whole=false;if(this.walking){const positions:Record<RoomId,[number,number]>={living:[-4.4,4.8],kitchen:[-3.3,-.8],studio:[4.3,3.4],bedroom:[-1.8,4.5],guest:[-1.8,-1],bathroom:[4.4,2],hallway:[1.8,4.3],upperHallway:[1.8,-4.4]};const p=positions[room];this.player.set(p[0],r.floor*3.3+1.65,p[1]);this.footY=r.floor*3.3;this.lookYaw=Math.atan2(-(r.x-p[0]),-(r.z-p[1]));this.lookPitch=-.07;}else{this.controls.target.set(r.x,r.floor*3.3,r.z);this.camera.position.set(r.x+11,r.floor*3.3+13,r.z+14);}this.updateVisibility();this.events.onRoom(room);this.events.onFloor(r.floor);}
  setWalk(active:boolean){
    this.walking=active;this.whole=false;this.controls.enabled=!active;this.keys.clear();
    if(active){this.focusRoom(this.lastRoom);this.camera.fov=65;this.camera.updateProjectionMatrix();}
    else {if(document.pointerLockElement)document.exitPointerLock();this.camera.fov=52;this.camera.updateProjectionMatrix();this.controls.target.set(0,this.floor*3.3,0);this.fitView();}
    this.updateVisibility();this.events.onWalk(active);
  }
  fitView(){const scale=Math.max(1,Math.min(1.9,.95/this.camera.aspect));this.camera.position.set(this.controls.target.x+17*scale,this.controls.target.y+16*scale,this.controls.target.z+21*scale);}
  overview(){if(this.walking)this.setWalk(false);this.whole=!this.whole;this.controls.target.set(0,this.whole?2:this.floor*3.3,0);this.camera.position.set(21,18,25);this.updateVisibility();}
  setBlueprint(v:boolean){this.blueprint=v;this.updateVisibility();}
  onPointerDown=(e:PointerEvent)=>{if(!this.walking)return;this.pointerDown=true;this.lastX=e.clientX;this.lastY=e.clientY;this.renderer.domElement.setPointerCapture(e.pointerId);};
  onPointerMove=(e:PointerEvent)=>{if(!this.walking||(!this.pointerDown&&!this.pointerLocked))return;const dx=this.pointerLocked?e.movementX:e.clientX-this.lastX,dy=this.pointerLocked?e.movementY:e.clientY-this.lastY;this.lookYaw-=dx*.004;this.lookPitch=Math.max(-1.2,Math.min(1.2,this.lookPitch-dy*.004));this.lastX=e.clientX;this.lastY=e.clientY;};
  onPointerUp=()=>{this.pointerDown=false;};
  lockPointer(){if(this.walking)this.renderer.domElement.requestPointerLock()?.catch(()=>{});}
  isBlocked(x:number,z:number,f:number){if(x< -7.65||x>7.65||z< -5.65||z>5.65)return true;return this.colliders.some(b=>b.floor===f&&x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ);}
  tryMove(dx:number,dz:number){
    const move=(x:number,z:number)=>{
      const inStair=x>.87&&x<2.73&&z>=-3.15&&z<=2.65;
      const wasStair=this.player.x>.87&&this.player.x<2.73&&this.player.z>=-3.15&&this.player.z<=2.65;
      if(wasStair&&!inStair&&this.player.z>-2.9&&this.player.z<2.4)return;
      if(inStair&&!wasStair&&z>-2.9&&z<2.4)return;
      const f=this.footY>1.65?1:0;
      if(this.isBlocked(x,z,f))return;
      let y=this.footY;
      if(inStair)y=Math.max(0,Math.min(3.3,(2.4-z)/5.4*3.3));else y=this.footY>1.65?3.3:0;
      this.player.x=x;this.player.z=z;this.footY=y;
    };
    move(this.player.x+dx,this.player.z);move(this.player.x,this.player.z+dz);
  }
  animate=()=>{
    if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);const dt=Math.min(this.clock.getDelta(),.05);
    if(this.walking){
      let forward=(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)-(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0);let side=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0);
      if(this.keys.has('ArrowLeft'))this.lookYaw+=dt*1.5;if(this.keys.has('ArrowRight'))this.lookYaw-=dt*1.5;
      const len=Math.hypot(forward,side)||1;const speed=(this.keys.has('ShiftLeft')?4:2.5)*dt;
      this.tryMove((-Math.sin(this.lookYaw)*forward+Math.cos(this.lookYaw)*side)/len*speed,(-Math.cos(this.lookYaw)*forward-Math.sin(this.lookYaw)*side)/len*speed);
      this.player.y=THREE.MathUtils.lerp(this.player.y,this.footY+1.65,Math.min(1,dt*12));this.camera.position.copy(this.player);this.camera.rotation.order='YXZ';this.camera.rotation.set(this.lookPitch,this.lookYaw,0);
      const f=this.footY>1.65?1:0;if(f!==this.floor){this.floor=f;this.events.onFloor(f);}
      let room:RoomId|undefined;if(this.player.x<-.5)room=this.player.z>0?(f===0?'living':'bedroom'):(f===0?'kitchen':'guest');else if(this.player.x>3.1)room=f===0?'studio':'bathroom';else room=f===0?'hallway':'upperHallway';
      if(room&&room!==this.lastRoom){this.lastRoom=room;this.events.onRoom(room);}
      this.events.onPosition(this.player.x,this.player.z);
    }else this.controls.update();
    this.renderer.render(this.scene,this.camera);
  };
  screenshot(){return this.renderer.domElement.toDataURL('image/png');}
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resize.disconnect();this.controls.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.onPointerDown);this.renderer.domElement.removeEventListener('pointermove',this.onPointerMove);window.removeEventListener('pointerup',this.onPointerUp);window.removeEventListener('keydown',this.downListener);window.removeEventListener('keyup',this.upListener);window.removeEventListener('blur',this.blurListener);document.removeEventListener('pointerlockchange',this.modeListener);this.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});this.textures.forEach(t=>t.dispose());this.renderer.dispose();this.renderer.domElement.remove();}
}
