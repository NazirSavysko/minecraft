import{world as g,system as P}from"@minecraft/server";
const DECK={"rocket:missile4":{hw:1.15,fw:1.35,top:.55},"rocket:missile7":{hw:1.2,fw:1.9,top:.55}};
const SPOOL={"rocket:missile7":20};
const deckLast=new Map(),deckOn=new Map();
P.runInterval(()=>{
try{
for(const dn of ["overworld","nether","the_end"]){
const dm=g.getDimension(dn);
for(const tId in DECK){
const cfg=DECK[tId];
for(const s of dm.getEntities({type:tId})){
if(!s.isValid())continue;
const loc=s.location,key=s.id,prev=deckLast.get(key),rot=s.getRotation();
deckLast.set(key,{x:loc.x,y:loc.y,z:loc.z});
if(!prev)continue;
const dx=loc.x-prev.x,dy=loc.y-prev.y,dz=loc.z-prev.z;
const topY=loc.y+cfg.top,yawR=rot.y*Math.PI/180,cs=Math.cos(yawR),sn=Math.sin(yawR);
for(const p of dm.getPlayers({location:loc,maxDistance:cfg.fw+1.5})){
const wasOn=deckOn.get(p.id)===key;
const rdx=p.location.x-loc.x,rdz=p.location.z-loc.z;
const lx=rdx*cs+rdz*sn,lz=-rdx*sn+rdz*cs;
const margin=wasOn?.35:0;
if(Math.abs(lx)>cfg.hw+margin||Math.abs(lz)>cfg.fw+margin){deckOn.delete(p.id);continue}
const rel=p.location.y-topY,relMax=wasOn?.6:.25;
if(rel<-.2||rel>relMax){deckOn.delete(p.id);continue}
deckOn.set(p.id,key);
let vy=0;try{vy=p.getVelocity().y}catch{}
const jumping=vy>.15;
const py=p.location.y;
let iy=0;
if(!jumping&&vy<0&&py<=topY+.08)iy=-vy;
const ix=dx*1.05,iz=dz*1.05;
if(Math.abs(ix)<1e-4&&Math.abs(iz)<1e-4&&iy<1e-4)continue;
try{p.applyImpulse({x:ix,y:iy,z:iz})}catch{}
}
}
}
}
}catch{}
},1);

import{ActionFormData as AFD}from"@minecraft/server-ui";const _=new Map,N=30,O=.4,R={"rocket:missile":.34,"rocket:missile2":.4,"rocket:missile3":.28,"rocket:missile4":.26,"rocket:missile5":.3,"rocket:missile6":.22,"rocket:missile7":.22},V={"rocket:missile":["custom.rocket.fly",121],"rocket:missile2":["custom.rocket.fly",121],"rocket:missile3":["custom.shahed3.fly",248],"rocket:missile4":["custom.shahed3.fly",248],"rocket:missile5":["custom.darts.fly",330],"rocket:missile6":["custom.molniya1.fly",330],"rocket:missile7":["custom.fp1.fly",230]},M=8,w=["rocket:missile","rocket:missile2","rocket:missile3","rocket:missile4","rocket:missile5","rocket:missile6","rocket:missile7"];const PHY={"rocket:missile":{tr:14,cm:.95,tm:.9,am:.85,sr:18,srMin:.55},"rocket:missile2":{tr:14,cm:.95,tm:.9,am:.85,sr:18,srMin:.55},"rocket:missile3":{tr:10,cm:.9,tm:.8,am:.75,sr:30,srMin:.4},"rocket:missile4":{tr:10,cm:.9,tm:.85,am:.8,sr:30,srMin:.4},"rocket:missile5":{tr:9,cm:1.05,tm:1.1,am:1.1,sr:26,srMin:.45},"rocket:missile6":{tr:7,cm:1.05,tm:.95,am:.7,sr:34,srMin:.35},"rocket:missile7":{tr:10,cm:1.05,tm:1.1,am:1.1,sr:26,srMin:.45}};function H(n,route){let h=[];try{const raw=n.getDynamicProperty("bpla_route_history");h=raw?JSON.parse(raw):[]}catch(err){h=[]}h.push({route:route,time:Date.now()});if(h.length>15)h=h.slice(h.length-15);n.setDynamicProperty("bpla_route_history",JSON.stringify(h))}function B(n,e,o){let t=(e-n+540)%360-180;return n+t*o}function F(n,e,o){return n+(e-n)*o}function z(n,e,o){let t=_.get(n.id)||[];o?(t.push(e),n.setDynamicProperty("last_bpla_route",JSON.stringify(t)),H(n,t),_.delete(n.id),n.sendMessage("\xA7e[\u0411\u041F\u041B\u0410] \u041C\u0430\u0440\u0448\u0440\u0443\u0442 \u0433\u043E\u0442\u043E\u0432! \u041D\u0430\u0436\u043C\u0438 \u043D\u0430 \u0411\u041F\u041B\u0410 \u0434\u043B\u044F \u0437\u0430\u043F\u0443\u0441\u043A\u0430.")):t.length<M?(t.push(e),_.set(n.id,t),n.sendMessage(`\xA7a[\u0411\u041F\u041B\u0410] \u0422\u043E\u0447\u043A\u0430 ${t.length}/${M} \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u0430!`)):n.sendMessage(`\xA7c[\u0411\u041F\u041B\u0410] \u0423\u0436\u0435 ${M} \u0442\u043E\u0447\u0435\u043A! \u0417\u0430\u0434\u0430\u0439 \u0442\u043E\u0447\u043A\u0443 \u0443\u0434\u0430\u0440\u0430.`)}function SP(e,id,loc){try{e.spawnParticle(id,loc)}catch{}}function flashPlayers(dim,loc){try{for(const pl of g.getAllPlayers()){if(!pl.isValid()||pl.dimension.id!==dim.id)continue;const pd=pl.getHeadLocation?pl.getHeadLocation():{x:pl.location.x,y:pl.location.y+1.6,z:pl.location.z};const dx=loc.x-pd.x,dy=loc.y-pd.y,dz=loc.z-pd.z,dist=Math.hypot(dx,dy,dz);if(dist>55||dist<.05)continue;const vd=pl.getViewDirection(),dot=(vd.x*dx+vd.y*dy+vd.z*dz)/dist;if(dot>.7){const kf=1-dist/55,near=Math.max(0,dot-.7)/.3;try{pl.camera.fade({fadeTime:{fadeInTime:.02,holdTime:.1+.3*kf*near,fadeOutTime:.8+.7*kf*near},fadeColor:{red:1,green:1,blue:1}})}catch{}}}}catch{}}const SM=[];function startSmoke(dim,x,y,z){const B=[[0,.3,0],[1.1,.7,.4],[-1,.6,-.5],[.6,1,-1],[-.7,.9,1],[.2,1.5,.2],[1.3,1.4,-1],[-1.3,1.3,.8],[0,2,0],[.8,.3,1.2],[-.9,.3,-1.1],[1.6,.5,.6],[-1.6,.6,-.6],[.3,2.4,-.3]];for(const[ox,oy,oz]of B)SP(dim,"minecraft:campfire_tall_smoke_particle",{x:x+ox,y:y+oy,z:z+oz});SM.push({dim,x,y,z,t:0})}P.runInterval(()=>{for(let i=SM.length-1;i>=0;i--){const j=SM[i];j.t+=3;if(j.t>=2400){SM.splice(i,1);continue}const pr=j.t/2400,rad=1.1+pr*7.0,rise=0.4+Math.pow(pr,0.7)*15,puffs=4+(pr<0.4?3:0);for(let k=0;k<puffs;k++){const ang=Math.random()*Math.PI*2,rr=rad*(0.15+Math.random()*0.9),px=j.x+Math.cos(ang)*rr,pz=j.z+Math.sin(ang)*rr,py=j.y+rise+(Math.random()*2-1)*1.4*pr,pid=Math.random()<0.75?"minecraft:campfire_tall_smoke_particle":"minecraft:basic_smoke_particle";SP(j.dim,pid,{x:px,y:py,z:pz})}for(let k=0;k<2;k++){const cx=j.x+(Math.random()*2-1)*0.6,cz=j.z+(Math.random()*2-1)*0.6,cy=j.y+rise*0.35+(Math.random()*2-1)*0.6;SP(j.dim,"minecraft:campfire_tall_smoke_particle",{x:cx,y:cy,z:cz})}}},3);g.beforeEvents.playerInteractWithBlock.subscribe(n=>{const{itemStack:e,player:o,block:t}=n;if(!e||!o||!t)return;const s=e.typeId;s==="bpla:remote_waypoint"&&P.run(()=>{const r={x:t.location.x+.5,y:t.location.y+N,z:t.location.z+.5};z(o,r,!1)}),s==="bpla:remote_target"&&P.run(()=>{const r={x:t.location.x+.5,y:t.location.y+.5,z:t.location.z+.5};z(o,r,!0)})}),g.afterEvents.playerInteractWithEntity.subscribe(n=>{const{player:e,target:o}=n;if(!e||!o||!w.includes(o.typeId))return;if(o.getDynamicProperty("is_launched")){e.sendMessage("\xA7c[\u0411\u041F\u041B\u0410] \u0420\u0430\u043A\u0435\u0442\u0430 \u0443\u0436\u0435 \u0432 \u043F\u043E\u043B\u0451\u0442\u0435!");return}const t=e.getDynamicProperty("last_bpla_route");if(!t){e.sendMessage("\xA7c[БПЛА] Маршрут не задан пультом!");return}o.setDynamicProperty("bpla_route",t),o.setDynamicProperty("is_launched",!0),o.setDynamicProperty("current_pitch",0),o.setDynamicProperty("current_yaw",o.getRotation().y),o.setDynamicProperty("route_snd",0),o.setDynamicProperty("flight_ticks",0),o.setDynamicProperty("is_hit",!1),o.setDynamicProperty("hit_pitch",void 0),o.setDynamicProperty("spool_ticks",0),o.setDynamicProperty("spd_factor",1),o.setDynamicProperty("yaw_rate",0),o.setDynamicProperty("best_p",void 0),o.setDynamicProperty("turned",0),(()=>{try{o.triggerEvent("rocket:route_start")}catch{}})(),e.setDynamicProperty("last_bpla_route",void 0);const[rs]=V[o.typeId]||["custom.shahed3.fly",248];try{o.runCommand("playsound firework.launch @a ~ ~ ~ 3.0 0.7"),engSnd(o,rs,!0),(o.typeId==="rocket:missile"||o.typeId==="rocket:missile2")&&o.runCommand("playsound ambient.weather.thunder @a ~ ~ ~ 0.5 0.35")}catch{}if(o.typeId==="rocket:missile")try{const dm=o.dimension,lc=o.location,rt=o.getRotation(),rad=rt.y*Math.PI/180,bx=lc.x+Math.sin(rad)*.6,bz=lc.z-Math.cos(rad)*.6;SP(dm,"minecraft:basic_flame_particle",{x:bx,y:lc.y+.3,z:bz}),SP(dm,"minecraft:campfire_smoke_particle",{x:bx,y:lc.y+.4,z:bz}),SP(dm,"minecraft:campfire_smoke_particle",{x:bx,y:lc.y+.6,z:bz}),SP(dm,"minecraft:basic_smoke_particle",{x:lc.x,y:lc.y+.3,z:lc.z})}catch{}e.sendMessage("\xA7a[\u0411\u041F\u041B\u0410] \u0421\u0442\u0430\u0440\u0442 \u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D!")}),g.afterEvents.entitySpawn.subscribe(ev=>{const s=ev.entity;if(!s||!w.includes(s.typeId))return;let tries=0;const tryMount=()=>{tries++;try{if(!s.isValid()||s.getDynamicProperty("is_launched")||s.typeId==="rocket:missile2")return;const dim=s.dimension,near=dim.getEntities({location:s.location,maxDistance:6,type:"bpla:launcher"});if(!near||near.length===0){if(tries<10){P.runTimeout(tryMount,4);return}try{const rdim=s.dimension,rloc=s.location;for(const pl of rdim.getPlayers({location:rloc,maxDistance:10}))try{pl.sendMessage("\xA7c[\u0411\u041F\u041B\u0410] \u042D\u0442\u043E\u0442 \u0434\u0440\u043E\u043D \u043C\u043E\u0436\u043D\u043E \u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430 \u041F\u0423!")}catch{}}catch{}try{s.remove()}catch{}return}const lch=near[0],lr=lch.getRotation(),ll=lch.location,rad=lr.y*Math.PI/180,mountCfg={"rocket:missile":{z:.85,y:.62,p:-32},"rocket:missile2":{z:.5,y:.6,p:15},"rocket:missile3":{z:.85,y:.62,p:-32},"rocket:missile4":{z:.85,y:.62,p:-32},"rocket:missile5":{z:.85,y:.38,p:-32},"rocket:missile6":{z:.75,y:.72,p:-32},"rocket:missile7":{z:.85,y:.15,p:-32}},cfg=mountCfg[s.typeId]||{z:.85,y:.8,p:-25},mx=ll.x-Math.sin(rad)*cfg.z,mz=ll.z+Math.cos(rad)*cfg.z,my=ll.y+cfg.y,mp=cfg.p;s.teleport({x:mx,y:my,z:mz},{rotation:{x:mp,y:lr.y}});s.setDynamicProperty("mount_yaw",lr.y);s.setDynamicProperty("mount_pitch",mp);s.setDynamicProperty("mount_pos",JSON.stringify({x:mx,y:my,z:mz}));try{s.triggerEvent("rocket:mount")}catch{}}catch{}};P.runTimeout(tryMount,2)}),g.afterEvents.itemUse.subscribe(ev=>{const n=ev.source,e=ev.itemStack;if(!e||e.typeId!=="bpla:remote_orange"||!n)return;let h=[];try{const raw=n.getDynamicProperty("bpla_route_history");h=raw?JSON.parse(raw):[]}catch(err){h=[]}if(h.length===0){n.sendMessage("\xA7c[\u0411\u041F\u041B\u0410] \u0410\u0440\u0445\u0438\u0432 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u043E\u0432 \u043F\u0443\u0441\u0442!");return}const list=h.slice().reverse();const form=new AFD().title("\u0410\u0440\u0445\u0438\u0432 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u043E\u0432").body("\u0412\u044B\u0431\u0435\u0440\u0438 \u043C\u0430\u0440\u0448\u0440\u0443\u0442 \u0434\u043B\u044F \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0433\u043E \u0443\u0434\u0430\u0440\u0430:");for(const it of list){const dt=new Date(it.time),stamp=dt.toLocaleString("ru-RU");form.button(`${it.route.length} \u0442\u043E\u0447. | ${stamp}`)}form.show(n).then(res=>{if(res.canceled||res.selection===void 0)return;const chosen=list[res.selection],route=JSON.parse(JSON.stringify(chosen.route)),last=route[route.length-1],scatter=5;last.x+=(Math.random()*2-1)*scatter,last.z+=(Math.random()*2-1)*scatter,n.setDynamicProperty("last_bpla_route",JSON.stringify(route)),n.sendMessage("\xA76[\u0411\u041F\u041B\u0410] \u041C\u0430\u0440\u0448\u0440\u0443\u0442 \u0438\u0437 \u0430\u0440\u0445\u0438\u0432\u0430 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D! \u0423\u0434\u0430\u0440 \u043D\u0435\u0442\u043E\u0447\u043D\u044B\u0439 (\u0440\u0430\u0437\u0431\u0440\u043E\u0441 ~"+scatter+" \u043C). \u041D\u0430\u0436\u043C\u0438 \u043D\u0430 \u0411\u041F\u041B\u0410.")}).catch(()=>{})}),g.afterEvents.entityHurt.subscribe(ev=>{const s=ev.hurtEntity;if(!s||!w.includes(s.typeId))return;if(!s.getDynamicProperty("is_launched")||s.getDynamicProperty("is_hit"))return;s.setDynamicProperty("is_hit",!0);}),P.runInterval(()=>{for(const n of["overworld","nether","the_end"]){const e=g.getDimension(n);for(const o of w){let t=[];try{t=e.getEntities({type:o})}catch{continue}for(const s of t)try{if(!s.isValid())continue;if(!s.getDynamicProperty("is_launched")){const my_=s.getDynamicProperty("mount_yaw"),mp_=s.getDynamicProperty("mount_pitch");if(my_!==void 0&&mp_!==void 0){try{const cr=s.getRotation();if(Math.abs(cr.x-mp_)>.5||Math.abs(cr.y-my_)>.5)s.setRotation({x:mp_,y:my_})}catch{try{s.teleport(s.location,{rotation:{x:mp_,y:my_}})}catch{}}}continue}if(s.getDynamicProperty("is_hit")){const i=s.location,m=s.getRotation(),rad=m.y*Math.PI/180,tx=i.x+Math.sin(rad)*1.3,tz=i.z-Math.cos(rad)*1.3,ty=i.y+.3;try{e.spawnParticle("minecraft:basic_flame_particle",{x:tx,y:ty,z:tz}),e.spawnParticle("minecraft:basic_flame_particle",{x:tx,y:ty,z:tz}),e.spawnParticle("minecraft:campfire_smoke_particle",{x:tx,y:ty+.2,z:tz})}catch{}const nx=i.x-Math.sin(rad)*.25,nz=i.z+Math.cos(rad)*.25,ny=i.y-.55;let hp=s.getDynamicProperty("hit_pitch");hp=hp===void 0?m.x:hp;hp=F(hp,80,.12);s.setDynamicProperty("hit_pitch",hp);s.teleport({x:nx,y:ny,z:nz},{rotation:{x:hp,y:m.y}});{const[rs,rt]=V[o]||["custom.shahed3.fly",248];let rc=(s.getDynamicProperty("route_snd")??0)+1;rc%10===0&&rc<rt&&engSnd(s,rs,!1),rc>=rt&&(engRefresh(s,rs),rc=0),s.setDynamicProperty("route_snd",rc)}let below=null;try{below=e.getBlock({x:Math.floor(nx),y:Math.floor(ny)-1,z:Math.floor(nz)})}catch{}if(ny<-63||below&&below.typeId!=="minecraft:air"){s.setDynamicProperty("is_launched",!1),s.setDynamicProperty("is_hit",!1);try{SP(e,"minecraft:huge_explosion_emitter",{x:nx,y:ny,z:nz}),SP(e,"minecraft:large_explosion",{x:nx,y:ny,z:nz}),SP(e,"minecraft:large_explosion",{x:nx+.4,y:ny+.3,z:nz}),SP(e,"minecraft:large_explosion",{x:nx-.4,y:ny+.3,z:nz}),SP(e,"minecraft:knockback_roar_particle",{x:nx,y:ny,z:nz}),SP(e,"rocket:explosion_flash",{x:nx,y:ny,z:nz}),startSmoke(e,nx,ny,nz)}catch{}flashPlayers(e,{x:nx,y:ny,z:nz});engCleanup(s.id,(V[o]||["custom.shahed3.fly",248])[0]);try{s.triggerEvent("rocket:explode")}catch{}}continue}const spoolMax=SPOOL[o]??40;let sp=s.getDynamicProperty("spool_ticks");if(sp!==void 0&&sp<spoolMax){s.setDynamicProperty("spool_ticks",sp+1);try{const mpJ=s.getDynamicProperty("mount_pos"),my_=s.getDynamicProperty("mount_yaw"),mp_=s.getDynamicProperty("mount_pitch");if(mpJ!==void 0){const mp2=JSON.parse(mpJ);s.teleport(mp2,{rotation:{x:mp_??s.getRotation().x,y:my_??s.getRotation().y}})}}catch{}continue}let D=s.getDynamicProperty("bpla_route");if(!D)continue;let a=JSON.parse(D);if(a.length===0)continue;const l=a[0],i=s.location,d=a.length===1;try{e.spawnParticle("minecraft:basic_flame_particle",l)}catch{}const y=l.x-i.x,f=l.y-i.y,u=l.z-i.z,p=Math.hypot(y,u),h=Math.hypot(y,f,u),stl=(()=>{const tn=(s.getDynamicProperty("turned")??0)+Math.abs(s.getDynamicProperty("yaw_rate")??0);s.setDynamicProperty("turned",tn);return tn})(),j=d?Math.max(Math.max(0,Math.min(1,(26-p)/12)),Math.min(1,Math.max(0,(stl-160)/140))):0;if(d?h<2||(p<3&&i.y<=l.y+.6):(p<(()=>{let rb=Math.max(4.5,((PHY[o]||{}).tr??12)/((PHY[o]||{}).tm??1)*1.1);const nx=a[1];if(nx){const sg=Math.hypot(nx.x-l.x,nx.z-l.z);rb*=1+.6*Math.max(0,Math.min(1,(2*rb-sg)/(2*rb)));const b1=Math.atan2(l.z-i.z,l.x-i.x),b2=Math.atan2(nx.z-l.z,nx.x-l.x),dp=Math.abs((((b2-b1+Math.PI)%(2*Math.PI))+2*Math.PI)%(2*Math.PI)-Math.PI);rb=Math.max(rb,((PHY[o]||{}).tr??12)/((PHY[o]||{}).tm??1)*(1.1+1.6*dp/Math.PI))}return rb})()||stl>200))if(d){s.setDynamicProperty("is_launched",!1);try{SP(e,"minecraft:huge_explosion_emitter",l),SP(e,"minecraft:large_explosion",l),SP(e,"minecraft:large_explosion",{x:l.x+.4,y:l.y+.3,z:l.z}),SP(e,"minecraft:large_explosion",{x:l.x-.4,y:l.y+.3,z:l.z}),SP(e,"minecraft:knockback_roar_particle",l),SP(e,"rocket:explosion_flash",l),startSmoke(e,l.x,l.y,l.z)}catch{}flashPlayers(e,l);engCleanup(s.id,(V[o]||["custom.shahed3.fly",248])[0]);try{s.triggerEvent("rocket:explode")}catch{}continue}else a.shift(),s.setDynamicProperty("bpla_route",JSON.stringify(a)),s.setDynamicProperty("best_p",void 0),s.setDynamicProperty("turned",0);else{const phy=PHY[o]||{},cm=phy.cm??1,tm=phy.tm??1,am=phy.am??1;let ft=(s.getDynamicProperty("flight_ticks")??20)+1;s.setDynamicProperty("flight_ticks",ft);const srm=phy.sr?Math.max(phy.srMin??.4,Math.min(1,ft/phy.sr)):1;const cBase=(R[o]??O)*srm,m=s.getRotation();let curYaw=s.getDynamicProperty("current_yaw");curYaw===void 0&&(curYaw=m.y);let x=curYaw;if(p>=.2){const th_=Math.atan2(-y,u)*180/Math.PI;x=p>=1.2?th_:B(curYaw,th_,Math.max(0,(p-.2)/1))}const E=-(Math.atan2(f,p)*180)/Math.PI;const G=(25+j*60)*cm;let L=Math.max(-G,Math.min(G,E));if(phy.cb&&!d){const cd=Math.max(0,(40-ft)/40);L-=phy.cb*cd}const rampF=Math.max(.3,Math.min(1,(ft*am)/24)),I=(.075+j*.05)*rampF*tm;let W=s.getDynamicProperty("current_pitch")??m.x;const yErr=(x-curYaw+540)%360-180,maxYr=(cBase/(phy.tr??12))*57.2958*tm*rampF*(1+j*3);let yr=s.getDynamicProperty("yaw_rate")??0;const wYr=Math.max(-maxYr,Math.min(maxYr,yErr*.04*(1+j*3)));yr=F(yr,wYr,.2);s.setDynamicProperty("yaw_rate",yr);const A=(curYaw+yr+540)%360-180;let dv=F(W,L,I)-W;const pr=2*rampF*(1+j*1.5);dv=Math.max(-pr,Math.min(pr,dv));const v=W+dv;s.setDynamicProperty("current_pitch",v);s.setDynamicProperty("current_yaw",A);let S,k,T;if(d){const c=cBase*(v>=0?1+Math.min(v,70)/70*.2:1);const wb=j*j*(3-2*j),ry0=A*Math.PI/180,rp0=v*Math.PI/180,bx=-Math.sin(ry0)*Math.cos(rp0)*(1-wb)+y/h*wb,by=-Math.sin(rp0)*(1-wb)+f/h*wb,bz=Math.cos(ry0)*Math.cos(rp0)*(1-wb)+u/h*wb,bl=Math.hypot(bx,by,bz)||1;S=bx/bl*c,k=by/bl*c,T=bz/bl*c}else{const yawDelta=Math.min(Math.abs(A-curYaw),45),targetFactor=(v>=0?1+Math.min(v,70)/70*.2:1+Math.max(v,-45)/45*.15)*(1-yawDelta/45*.08),prevFactor=s.getDynamicProperty("spd_factor")??1,spdFactor=F(prevFactor,targetFactor,.25);s.setDynamicProperty("spd_factor",spdFactor);const c=cBase*spdFactor,rY=A*Math.PI/180,rP=v*Math.PI/180;S=-Math.sin(rY)*Math.cos(rP)*c,k=-Math.sin(rP)*c,T=Math.cos(rY)*Math.cos(rP)*c}const Y={x:i.x+S,y:i.y+k,z:i.z+T};{const ch=ft>=DC_GRACE?droneCol(e,o,Y,i,A,v):null;if(ch){droneCrash(e,s,o,ch);continue}}s.teleport(Y,{rotation:{x:v,y:A}});try{s.clearVelocity();s.applyImpulse({x:S,y:k,z:T})}catch{}const[rs,rt]=V[o]||["custom.shahed3.fly",248];let rc=(s.getDynamicProperty("route_snd")??0)+1;rc%10===0&&rc<rt&&engSnd(s,rs,!1),rc>=rt&&(engRefresh(s,rs),(o==="rocket:missile"||o==="rocket:missile2")&&s.runCommand("playsound ambient.weather.thunder @a ~ ~ ~ 0.5 0.35"),rc=0),s.setDynamicProperty("route_snd",rc)}}catch{}}}},1);
const ENG_NEAR=new Map();function engCleanup(id,rs){for(const[pid,m]of ENG_NEAR){const set=m.get(rs);if(set&&set.delete(id)&&set.size===0){try{g.getAllPlayers().find(p=>p.id===pid)?.runCommand("stopsound @s "+rs)}catch{}}}}function engRefresh(s,rs){try{for(const pl of g.getAllPlayers()){const m=ENG_NEAR.get(pl.id),set=m&&m.get(rs);if(set&&set.has(s.id))try{pl.runCommand("stopsound @s "+rs);pl.playSound(rs)}catch{}}}catch{}}function engSnd(s,rs,first){try{const dm=s.dimension,near=new Set(dm.getPlayers({location:s.location,maxDistance:80}).map(p=>p.id));let prev=[];if(!first)try{prev=JSON.parse(s.getDynamicProperty("eng_ids")??"[]")}catch{}for(const pl of dm.getPlayers()){const a=near.has(pl.id),b=prev.includes(pl.id);if(a&&!b){let m=ENG_NEAR.get(pl.id);if(!m){m=new Map();ENG_NEAR.set(pl.id,m)}let set=m.get(rs);if(!set){set=new Set();m.set(rs,set)}const wasEmpty=set.size===0;set.add(s.id);if(wasEmpty)try{pl.runCommand("stopsound @s "+rs);pl.playSound(rs)}catch{}}else if(!a&&b){const m=ENG_NEAR.get(pl.id),set=m&&m.get(rs);if(set){set.delete(s.id);if(set.size===0)try{pl.runCommand("stopsound @s "+rs)}catch{}}}}s.setDynamicProperty("eng_ids",JSON.stringify([...near]))}catch{}}function fp1Cleanup(id){engCleanup(id,"custom.fp1.fly")}function fp1Refresh(s){engRefresh(s,"custom.fp1.fly")}function fp1Snd(s,first){engSnd(s,"custom.fp1.fly",first)}
// ================= DEBRIS PHYSICS (own engine, vanilla-like AABB block collision) =================
const DBT={
 "rocket:debris_fp1":{sc:1.2,m:[1,1,.25,.5,.7,2],w:[1.763,1.763,.039,1.59,.106,.928],d:[.524,.524,.04,.384,1.809,1.054],h:[.344,.344,.861,.623,.099,.967]},
 "rocket:debris_gerbera":{sc:1,m:[1,1,.25,2.5,1.6,3],w:[1.87,1.87,.066,.398,.583,.888],d:[2.027,2.027,.066,.133,.928,2.955],h:[.133,.133,.596,.331,.331,.795]}
};
const DBG=Object.keys(DBT),DS=new Map(),BC=new Map();
const D_G=.05,D_AIR=.995,D_FR=.85,D_E=.48,D_EPS=1e-4;
const NOCOL=/^(air|cave_air|void_air|structure_void|light_block.*|light|moving_block|bubble_column|short_grass|leaf_litter|bush|firefly_bush|short_dry_grass|tall_dry_grass|wildflowers|pink_petals|cactus_flower|tall_grass|tallgrass|double_plant|fern|large_fern|deadbush|dead_bush|seagrass|kelp|.*sapling|propagule|red_flower|yellow_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower.*|pitcher_.*|sunflower|lilac|rose_bush|peony|red_mushroom|brown_mushroom|hanging_roots|crimson_roots|warped_roots|nether_sprouts|spore_blossom|glow_lichen|sculk_vein|vine|.*_vines.*|sweet_berry_bush|wheat|carrots|potatoes|beetroot|(melon|pumpkin)_stem|attached_.*_stem|reeds|sugar_cane|bamboo_sapling|cocoa|nether_wart|.*coral_fan.*|.*coral_wall_fan|sea_pickle|.*candle|.*candle_cake|.*torch|.*lantern|end_rod|lightning_rod|.*chain|fire|soul_fire|redstone_wire|.*repeater|.*comparator|lever|.*button|.*pressure_plate|.*sign|.*banner|.*rail|web|tripwire.*|string|flower_pot|.*_door|end_portal|portal|end_gateway|lily_pad|frame|glow_frame|scaffolding_air|hanging_.*sign|decorated_pot_air)$/;
const LIQ=/^(flowing_)?(water|lava)$/;
const FULLB=[[0,0,0,1,1,1]];
function stg(b,n){try{return b.permutation.getState(n)}catch{return undefined}}
function blockBoxes(b){
 const id=String(b.typeId).replace(/^[a-z_0-9]+:/,"");
 if(NOCOL.test(id)||LIQ.test(id))return[];
 if(/slab/.test(id)&&!/double/.test(id)){const t=stg(b,"minecraft:vertical_half");return t==="top"?[[0,.5,0,1,1,1]]:[[0,0,0,1,.5,1]]}
 if(/_stairs$/.test(id)){const up=stg(b,"upside_down_bit")===true,d=stg(b,"weirdo_direction")|0;const base=up?[0,.5,0,1,1,1]:[0,0,0,1,.5,1],y0=up?0:.5,y1=up?.5:1;const stp=d===0?[.5,y0,0,1,y1,1]:d===1?[0,y0,0,.5,y1,1]:d===2?[0,y0,.5,1,y1,1]:[0,y0,0,1,y1,.5];return[base,stp]}
 if(/carpet$/.test(id))return[[0,0,0,1,.0625,1]];
 if(id==="snow_layer"){const h=(stg(b,"height")|0)+1;return[[0,0,0,1,Math.min(8,h)/8,1]]}
 if(/(fence|_wall|fence_gate)$/.test(id)&&!/gate/.test(id))return[[0,0,0,1,1.5,1]];
 if(/fence_gate$/.test(id))return stg(b,"open_bit")===true?[]:[[0,0,0,1,1.5,1]];
 if(/trapdoor$/.test(id)){if(stg(b,"open_bit")===true)return[];return stg(b,"upside_down_bit")===true?[[0,.8125,0,1,1,1]]:[[0,0,0,1,.1875,1]]}
 if(/bed$/.test(id))return[[0,0,0,1,.5625,1]];
 if(/(farmland|dirt_path|grass_path)$/.test(id))return[[0,0,0,1,.9375,1]];
 if(/(^|_)chest$/.test(id))return[[.0625,0,.0625,.9375,.875,.9375]];
 return FULLB;
}
function bxs(dm,x,y,z){
 const k=dm.id+"|"+x+"|"+y+"|"+z,c=BC.get(k),now=P.currentTick;
 if(c&&now-c.t<6)return c;
 let b,r;try{b=dm.getBlock({x,y,z})}catch{b=void 0}
 if(!b)r={t:now,b:null,liq:!1};else r={t:now,b:blockBoxes(b),liq:LIQ.test(String(b.typeId).replace(/^[a-z_0-9]+:/,""))};
 BC.set(k,r);return r;
}
function region(dm,x0,y0,z0,x1,y1,z1){
 const out=[];
 for(let bx=Math.floor(x0);bx<=Math.floor(x1);bx++)for(let by=Math.floor(y0)-1;by<=Math.floor(y1);by++)for(let bz=Math.floor(z0);bz<=Math.floor(z1);bz++){
  const e=bxs(dm,bx,by,bz);if(e.b===null)return null;
  for(const q of e.b)out.push([bx+q[0],by+q[1],bz+q[2],bx+q[3],by+q[4],bz+q[5]]);
 }
 return out;
}
// vanilla-style move: depenetrate, then Y, X, Z clipping against block boxes. returns flags or null (chunk not loaded)
function moveCol(dm,st,dx,dy,dz){
 const hwx=st.hwx,hwz=st.hwz,h=st.h;
 const R=region(dm,st.x-hwx+Math.min(0,dx)-.01,st.y+Math.min(0,dy)-.01,st.z-hwz+Math.min(0,dz)-.01,st.x+hwx+Math.max(0,dx)+.01,st.y+h+Math.max(0,dy)+.01,st.z+hwz+Math.max(0,dz)+.01);
 if(R===null)return null;
 const f={gnd:!1,hx:!1,hy:!1,hz:!1,ax:0,ay:0,az:0};
 let top=-1e9;
 for(const b of R)if(st.x+hwx>b[0]+D_EPS&&st.x-hwx<b[3]-D_EPS&&st.z+hwz>b[2]+D_EPS&&st.z-hwz<b[5]-D_EPS&&st.y+h>b[1]+D_EPS&&st.y<b[4]-D_EPS)top=Math.max(top,b[4]);
 if(top>-1e8){st.y=Math.min(top+D_EPS,st.y+.5);if(st.vy<0)st.vy=0}
 let ay=dy;
 for(const b of R)if(st.x+hwx>b[0]+D_EPS&&st.x-hwx<b[3]-D_EPS&&st.z+hwz>b[2]+D_EPS&&st.z-hwz<b[5]-D_EPS){
  if(ay<0&&b[4]<=st.y+D_EPS)ay=Math.max(ay,b[4]-st.y);else if(ay>0&&b[1]>=st.y+h-D_EPS)ay=Math.min(ay,b[1]-(st.y+h));
 }
 if(Math.abs(ay-dy)>1e-7){f.hy=!0;if(dy<0)f.gnd=!0}
 st.y+=ay;f.ay=ay;
 let ax=dx;
 for(const b of R)if(st.y+h>b[1]+D_EPS&&st.y<b[4]-D_EPS&&st.z+hwz>b[2]+D_EPS&&st.z-hwz<b[5]-D_EPS){
  if(ax>0&&b[0]>=st.x+hwx-D_EPS)ax=Math.min(ax,b[0]-(st.x+hwx));else if(ax<0&&b[3]<=st.x-hwx+D_EPS)ax=Math.max(ax,b[3]-(st.x-hwx));
 }
 if(Math.abs(ax-dx)>1e-7)f.hx=!0;
 st.x+=ax;f.ax=ax;
 let az=dz;
 for(const b of R)if(st.y+h>b[1]+D_EPS&&st.y<b[4]-D_EPS&&st.x+hwx>b[0]+D_EPS&&st.x-hwx<b[3]-D_EPS){
  if(az>0&&b[2]>=st.z+hwz-D_EPS)az=Math.min(az,b[2]-(st.z+hwz));else if(az<0&&b[5]<=st.z-hwz+D_EPS)az=Math.max(az,b[5]-(st.z-hwz));
 }
 if(Math.abs(az-dz)>1e-7)f.hz=!0;
 st.z+=az;f.az=az;
 return f;
}
function dbgWake(st){st.sl=!1;st.sc=0}
// one physics step for an awake piece
function dbgStep(dm,st){
 st.py=st.y;
 const e=bxs(dm,Math.floor(st.x),Math.floor(st.y+st.h*.5),Math.floor(st.z)),w=e.liq;
 st.vy-=w?D_G*.25:D_G;
 const dr=w?.88:D_AIR;st.vx*=dr;st.vz*=dr;st.vy*=w?.85:.98;
 const f=moveCol(dm,st,st.vx,st.vy,st.vz);
 if(f===null){st.vx=st.vy=st.vz=0;return}
 const eb=D_E/(1+.15*st.m);
 if(f.hy){if(st.vy<0){if(st.vy<-.14){st.vy=-st.vy*eb;st.vx*=.8;st.vz*=.8}else st.vy=0}else st.vy=0}
 if(f.hx)st.vx=Math.abs(st.vx)>.08?-st.vx*.35:0;
 if(f.hz)st.vz=Math.abs(st.vz)>.08?-st.vz*.35:0;
 st.gnd=f.gnd;
 if(st.gnd){st.vx*=D_FR;st.vz*=D_FR}
 if(st.gnd&&Math.abs(st.vx)<.006&&Math.abs(st.vz)<.006&&Math.abs(st.vy)<.06){if(++st.sc>=10){st.sl=!0;st.vx=st.vz=st.vy=0}}else st.sc=0;
}
// player <-> piece
function dbgPlayer(dm,st,pl){
 const pw=.3,ph=pl.sn?1.5:1.8,ox=pw+st.hwx-Math.abs(st.x-pl.x),oz=pw+st.hwz-Math.abs(st.z-pl.z),oy=Math.min(st.y+st.h,pl.y+ph)-Math.max(st.y,pl.y);
 if(ox<=0||oz<=0||oy<=.12)return!1;
 let nx=0,nz=0,dx=0,dz=0;
 if(ox<oz){nx=st.x>=pl.x?1:-1;dx=nx*ox}else{nz=st.z>=pl.z?1:-1;dz=nz*oz}
 const f=moveCol(dm,st,dx,0,dz);
 const vrel=(st.vx-pl.vx)*nx+(st.vz-pl.vz)*nz;
 if(vrel<0){const J=-(1.2)*vrel/(1/st.m+1/4);st.vx+=nx*J/st.m;st.vz+=nz*J/st.m}
 const ph2=Math.hypot(pl.vx,pl.vz);
 if(ph2>.24&&st.gnd)st.vy+=.14/Math.sqrt(st.m);
 dbgWake(st);return!0;
}
// piece <-> piece
function dbgPair(dm,a,b){
 const dx=a.x-b.x,dz=a.z-b.z,ox=a.hwx+b.hwx-Math.abs(dx),oz=a.hwz+b.hwz-Math.abs(dz),oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
 if(ox<=.005||oz<=.005||oy<=.005)return;
 const ia=1/a.m,ib=1/b.m,sm=ia+ib;let nx=0,ny=0,nz=0;
 if(oy<=ox&&oy<=oz){
  const pa=a.py===void 0?a.y:a.py,pb=b.py===void 0?b.y:b.py,up=pa>pb+.0001?a:pb>pa+.0001?b:(a.y>=b.y?a:b),lo=up===a?b:a;ny=up===a?1:-1;
  moveCol(dm,up,0,oy+.001,0);
  const vrel=(up.vy-lo.vy);
  if(vrel<0){const J=-(1.3)*vrel/(1/up.m+1/lo.m);up.vy+=J/up.m;lo.vy-=J/lo.m;if(Math.abs(up.vy)<.06){up.vy=0;up.gnd=!0}}
  dbgWake(a);dbgWake(b);return;
 }
 if(ox<oz){nx=dx>=0?1:-1;const s=ox+.002;moveCol(dm,a,nx*s*ia/sm,0,0);moveCol(dm,b,-nx*s*ib/sm,0,0)}
 else{nz=dz>=0?1:-1;const s=oz+.002;moveCol(dm,a,0,0,nz*s*ia/sm);moveCol(dm,b,0,0,-nz*s*ib/sm)}
 const vrel=(a.vx-b.vx)*nx+(a.vz-b.vz)*nz;
 if(vrel<0){const J=-(1.3)*vrel/sm;a.vx+=nx*J*ia;a.vz+=nz*J*ia;b.vx-=nx*J*ib;b.vz-=nz*J*ib}
 dbgWake(a);dbgWake(b);
}

function dbgIdx(s){try{const v=s.getProperty("rocket:piece");if(typeof v==="number")return v}catch{}try{const tf=s.getComponent("minecraft:type_family");for(let i=0;i<6;i++)if(tf&&tf.hasTypeFamily("pc"+i))return i}catch{}return 0}
function dbgLaunch(st){const a=Math.random()*Math.PI*2,sp=.4+Math.random()*.7,up=.6+Math.random()*.8,k=1/Math.pow(st.m,.35);st.vx=Math.cos(a)*sp*k;st.vz=Math.sin(a)*sp*k;st.vy=up*k;st.ln=!0;dbgWake(st)}
function dbgReg(s,launch){
 let st=DS.get(s.id);
 if(st){if(launch&&!st.ln)dbgLaunch(st);return st}
 const T=DBT[s.typeId];if(!T)return null;
 const pi=Math.max(0,Math.min(5,dbgIdx(s))),l=s.location;
 st={e:s,dm:s.dimension,pi,x:l.x,y:l.y,z:l.z,vx:0,vy:0,vz:0,hwx:T.w[pi]*T.sc/2,hwz:T.d[pi]*T.sc/2,h:T.h[pi]*T.sc,m:T.m[pi],sl:!1,sc:0,gnd:!1,gc:0,gf:!1,wx:l.x,wy:l.y,wz:l.z,ln:!1};
 DS.set(s.id,st);
 try{s.setRotation({x:0,y:Math.random()*360})}catch{}
 if(launch)dbgLaunch(st);
 return st;
}
function dbgGroundY(dm,x,z,fromY){
 for(let by=Math.floor(fromY+.001);by>=Math.floor(fromY)-4;by--){
  const e=bxs(dm,Math.floor(x),by,Math.floor(z));
  if(e.b===null)return null;
  if(e.liq)continue;
  if(e.b&&e.b.length){let top=-1e9;for(const q of e.b)top=Math.max(top,by+q[4]);return top}
 }
 return null;
}
function dbgTick(){
 if(!DS.size)return;
 const now=P.currentTick;if(BC.size>6000)BC.clear();
 const byDim=new Map();
 for(const[id,st]of DS){let ok=!1;try{ok=st.e.isValid()}catch{}if(!ok){DS.delete(id);continue}let a=byDim.get(st.dm.id);if(!a){a=[];byDim.set(st.dm.id,a)}a.push(st)}
 for(const[,list]of byDim){
  const dm=list[0].dm,pls=[];
  try{for(const p of dm.getPlayers()){const l=p.location,v=p.getVelocity();pls.push({x:l.x,y:l.y,z:l.z,vx:v.x,vz:v.z,sn:!!p.isSneaking})}}catch{}
  for(const st of list){
   if((now+st.pi*3)%10!==0)continue;
   try{
    const rl=st.e.location;
    if(Math.abs(rl.x-st.wx)+Math.abs(rl.y-st.wy)+Math.abs(rl.z-st.wz)>.08){
     st.x=st.wx=rl.x;st.y=st.wy=rl.y;st.z=st.wz=rl.z;
     try{st.e.clearVelocity()}catch{}
     dbgWake(st);
    }else if(st.sl){try{st.e.clearVelocity()}catch{}}
   }catch{}
  }
  for(const st of list){
   if(!st.sl)dbgStep(dm,st);
   else if((now+st.pi*3)%20===0){const f=moveCol(dm,st,0,-.02,0);if(f&&!f.gnd)dbgWake(st)}
  }
  for(const st of list)for(const pl of pls)if(Math.abs(st.x-pl.x)<st.hwx+.9&&Math.abs(st.z-pl.z)<st.hwz+.9&&Math.abs(st.y-pl.y)<2.2)dbgPlayer(dm,st,pl);
  for(let i=0;i<list.length;i++){const a=list[i];for(let j=i+1;j<list.length;j++){const b=list[j];if(a.sl&&b.sl)continue;if(Math.abs(a.x-b.x)>a.hwx+b.hwx||Math.abs(a.z-b.z)>a.hwz+b.hwz||Math.abs(a.y-b.y)>1.2)continue;dbgPair(dm,a,b)}}
  for(const st of list){
   st.gc=st.gnd||st.sl?Math.min(st.gc+1,4):Math.max(st.gc-1,-4);
   const nf=st.gc>=3?!0:st.gc<=-3?!1:st.gf;
   if(nf!==st.gf){st.gf=nf;try{st.e.triggerEvent(nf?"rocket:stuck":"rocket:unstuck")}catch{}
    if(nf){try{const gy=dbgGroundY(dm,st.x,st.z,st.y);if(gy!==null&&Math.abs(gy-st.y)<.3)st.y=gy}catch{}}
   }
   if(Math.abs(st.x-st.wx)+Math.abs(st.y-st.wy)+Math.abs(st.z-st.wz)>1e-4){let tpOk=!0;try{st.e.teleport({x:st.x,y:st.y,z:st.z})}catch{tpOk=!1}if(tpOk){st.wx=st.x;st.wy=st.y;st.wz=st.z}}
  }
 }
}
g.afterEvents.entitySpawn.subscribe(ev=>{try{const s=ev.entity;if(!s||!DBG.includes(s.typeId))return;P.runTimeout(()=>{try{if(s.isValid())dbgReg(s,!0)}catch{}},2)}catch{}});
try{g.afterEvents.entityHitEntity.subscribe(ev=>{try{const t=ev.hitEntity,a=ev.damagingEntity;if(!t||!a||!DBG.includes(t.typeId))return;const st=dbgReg(t,!1);if(!st)return;const d=a.getViewDirection(),k=1/Math.pow(st.m,.5);st.vx+=d.x*.55*k;st.vz+=d.z*.55*k;st.vy+=(.3+Math.max(0,d.y)*.4)*k;dbgWake(st)}catch{}})}catch{}
P.runInterval(()=>{try{dbgTick()}catch{}},1);
P.runInterval(()=>{try{for(const dn of["overworld","nether","the_end"]){const dm=g.getDimension(dn);for(const t of DBG)for(const s of dm.getEntities({type:t}))if(!DS.has(s.id))dbgReg(s,!1)}}catch{}},100);

// ================= UAV COLLISION (own, uses the same block boxes as debris) =================
// probes: [nose offset, wing offset] in blocks; body probe radius DC_R
const DCP={"rocket:missile":[2.6,.9],"rocket:missile2":[1.6,.6],"rocket:missile3":[2.6,.9],"rocket:missile4":[1.4,.9],"rocket:missile5":[.9,.7],"rocket:missile6":[1.1,.7],"rocket:missile7":[1.9,1.1]},DC_GRACE=60,DC_R=.18;
function dcPts(p,yaw,pit,n,wg){const ry=yaw*Math.PI/180,rp=pit*Math.PI/180,cp=Math.cos(rp),fx=-Math.sin(ry)*cp,fy=-Math.sin(rp),fz=Math.cos(ry)*cp,sx=Math.cos(ry),sz=Math.sin(ry),cy=p.y+.3;return[{x:p.x+fx*n,y:cy+fy*n,z:p.z+fz*n},{x:p.x,y:cy,z:p.z},{x:p.x+sx*wg,y:cy,z:p.z+sz*wg},{x:p.x-sx*wg,y:cy,z:p.z-sz*wg}]}
// returns the impact point (last free position of the probe that hit) or null
function droneCol(dm,o,Y,i,yaw,pit){try{if(BC.size>6000)BC.clear();const q=DCP[o]||[1.5,.8],a=dcPts(Y,yaw,pit,q[0],q[1]);for(let k=0;k<a.length;k++){const c=a[k],R=region(dm,c.x-DC_R,c.y-DC_R,c.z-DC_R,c.x+DC_R,c.y+DC_R,c.z+DC_R);if(R===null)continue;for(const b of R)if(c.x+DC_R>b[0]&&c.x-DC_R<b[3]&&c.y+DC_R>b[1]&&c.y-DC_R<b[4]&&c.z+DC_R>b[2]&&c.z-DC_R<b[5])return dcPts(i,yaw,pit,q[0],q[1])[k]}}catch{}return null}
function droneCrash(e,s,o,P0){s.setDynamicProperty("is_launched",!1);try{SP(e,"minecraft:huge_explosion_emitter",P0),SP(e,"minecraft:large_explosion",P0),SP(e,"minecraft:large_explosion",{x:P0.x+.4,y:P0.y+.3,z:P0.z}),SP(e,"minecraft:large_explosion",{x:P0.x-.4,y:P0.y+.3,z:P0.z}),SP(e,"minecraft:knockback_roar_particle",P0),SP(e,"rocket:explosion_flash",P0),startSmoke(e,P0.x,P0.y,P0.z)}catch{}flashPlayers(e,P0);engCleanup(s.id,(V[o]||["custom.shahed3.fly",248])[0]);try{s.teleport(P0)}catch{}try{s.triggerEvent("rocket:explode")}catch{}}

// ================= DRONE PART COLLISION (script raycast per model part: stand / jump / walk-into on FP-1 & Gerbera) =================
// Every cube of the model is an oriented box (OBB). Idle drones (not launched) are solid for players:
// vertical rays from the feet find the surface to stand on, OBB-vs-player SAT pushes the player out of the sides.
const PCM={"rocket:missile7":{sc:1.2,piv:[0,8,0],c:[[-2.04,8.2,-7.2,0.05,1,0.3,0,0,0],[-2.04,8.9,-8.05,0.05,0.3,0.55,0,0,0],[-1,10.15,-9.25,0.3,0.15,4.75,0,0,0],[0,8,0,2,2,4.5,0,0,0],[0,7.9,5.65,1.9,1.9,1.15,0,0,0],[1.05,9.82,5.1,0.55,0.05,0.9,0,0,0],[-1.05,9.82,5.1,0.55,0.05,0.9,0,0,0],[0,7.9,6.4,1.3,1.1,0.6,0,0,0],[0,7.9,7.3,0.5,0.45,0.3,0,0,0],[0,9.8,-0.05,2,0.4,3.75,0,0,0],[1,10.15,-9.25,0.3,0.15,4.75,0,0,0],[0,7.9,-15.05,1,0.9,1.25,0,0,0],[0,7.036,-14.974,1,0.5,1.25,-25,0,0],[0,8.768,-14.69,1,0.9,1.25,20,0,0],[-0.283,7.303,-13.864,1,0.9,1.25,-17.054,-11.735,-4.336],[0,8,-9.25,2,2,4.75,0,0,0],[0,8,-12.85,2.02,2.02,0.65,0,0,0],[-2.04,8.3,-12.85,0.05,0.3,0.35,0,0,0],[-2.04,7.2,-12.85,0.05,0.3,0.35,0,0,0],[11.216,7.9,-14.33,1,0.9,1.25,0,20,0],[11.216,7.9,-14.33,1,0.9,1.25,0,20,0],[-11.216,7.9,-14.33,1,0.9,1.25,0,-20,0],[7.961,8.341,-14.249,0.5,0.9,1.25,20.446,11.735,4.336],[0.283,7.303,-13.864,1,0.9,1.25,-17.054,11.735,4.336],[-11.216,7.9,-14.33,1,0.9,1.25,0,-20,0],[-7.961,8.341,-14.249,0.5,0.9,1.25,20.446,-11.735,-4.336],[15,9.8,-0.05,13,0.4,3.75,0,0,0],[2.7,8.95,0.25,0.7,0.45,2.75,0,0,0],[16,10.475,2.2,6,0.275,0.9,0,0,0],[10,10.45,2.2,0.5,0.25,0.9,0,0,-45],[22,10.45,2.2,0.5,0.25,0.9,0,0,45],[28.3,9.8,-0.05,0.3,1.4,3.95,0,0,0],[28.3,11.85,-0.85,0.25,0.65,2.65,0,0,0],[28.3,7.85,1.35,0.25,0.55,2.35,0,0,0],[-15,9.8,-0.05,13,0.4,3.75,0,0,0],[-2.7,8.95,0.25,0.7,0.45,2.75,0,0,0],[-16,10.475,2.2,6,0.275,0.9,0,0,0],[-10,10.45,2.2,0.5,0.25,0.9,0,0,45],[-22,10.45,2.2,0.5,0.25,0.9,0,0,-45],[-28.3,9.8,-0.05,0.3,1.4,3.95,0,0,0],[-28.3,11.85,-0.85,0.25,0.65,2.65,0,0,0],[-28.3,7.85,1.35,0.25,0.55,2.35,0,0,0],[8.5,9.65,1.95,0.8,0.75,1.95,0,0,0],[8.5,9.7,14.7,0.4,0.3,10.8,0,0,0],[8.5,9.65,26.4,0.8,0.65,0.9,0,0,0],[-8.5,9.65,1.95,0.8,0.75,1.95,0,0,0],[-8.5,9.7,14.7,0.4,0.3,10.8,0,0,0],[-8.5,9.65,26.4,0.8,0.65,0.9,0,0,0],[5.495,12.705,26.4,7.75,0.4,2.2,0,0,45],[5.318,12.882,29.2,2.5,0.4,0.6,0,0,45],[-5.495,12.705,26.4,7.75,0.4,2.2,0,0,-45],[-5.318,12.882,29.2,2.5,0.4,0.6,0,0,-45],[0,18.2,26.4,0.7,0.5,2.4,0,0,0],[0,10.15,-0.2,1.8,0.15,4,0,0,0],[1,10.95,-0.1,0.65,0.65,3.1,-25,0,0],[1,12.19,-2.9,0.6,0.6,0.7,-22.5,0,0],[1,10.95,3.5,0.5,0.5,0.5,0,0,0],[1,12.025,3.4,0.15,0.575,0.2,0,0,0],[-1,10.95,-0.1,0.65,0.65,3.1,-25,0,0],[-1,12.19,-2.9,0.6,0.6,0.7,-22.5,0,0],[-1,10.95,3.5,0.5,0.5,0.5,0,0,0],[-1,12.025,3.4,0.15,0.575,0.2,0,0,0]]},"rocket:missile4":{sc:1,piv:[0,3.31712,1.70432],c:[[0,3,1,3,3,22,0,0,0],[0,3,-22,2.5,2.5,1,0,0,0],[0,3,-23.5,2,2,0.5,0,0,0],[-13.5,3,17,10.5,0.5,5,0,0,0],[-12.8,3,11.5,9.8,0.5,0.5,0,0,0],[-12.3,3,10.5,9.3,0.5,0.5,0,0,0],[-11.8,3,9.5,8.8,0.5,0.5,0,0,0],[-11.3,3,8.5,8.3,0.5,0.5,0,0,0],[-10.95,3,7.5,7.95,0.5,0.5,0,0,0],[-10.3,3,6.5,7.3,0.5,0.5,0,0,0],[-9.8,3,5.5,6.8,0.5,0.5,0,0,0],[-9.3,3,4.5,6.3,0.5,0.5,0,0,0],[-8.8,3,3.5,5.8,0.5,0.5,0,0,0],[-8.3,3,2.5,5.3,0.5,0.5,0,0,0],[-7.75,3,1.5,4.75,0.5,0.5,0,0,0],[-7.3,3,0.5,4.3,0.5,0.5,0,0,0],[-6.8,3,-0.5,3.8,0.5,0.5,0,0,0],[-6.3,3,-1.5,3.3,0.5,0.5,0,0,0],[-6,3,-2.5,3,0.5,0.5,0,0,0],[-5.7,3,-3.5,2.7,0.5,0.5,0,0,0],[-5.45,3,-4.5,2.45,0.5,0.5,0,0,0],[-5.15,3,-5.5,2.15,0.5,0.5,0,0,0],[-4.85,3,-6.5,1.85,0.5,0.5,0,0,0],[-4.55,3,-7.5,1.55,0.5,0.5,0,0,0],[-4.3,3,-8.5,1.3,0.5,0.5,0,0,0],[-4,3,-9.5,1,0.5,0.5,0,0,0],[-3.7,3,-10.5,0.7,0.5,0.5,0,0,0],[-3.55,3,-11.7,0.55,0.5,0.7,0,0,0],[-16.666,3,5.407,9.8,0.5,0.5,0,-135,0],[-6.046,3,-8.087,7.8,0.5,0.5,0,-120,0],[0,9,19,0.5,3,2,0,0,0],[0,7.613,15.94,0.5,4,2,-40,0,0],[3.55,3,-11.7,0.55,0.5,0.7,0,0,0],[6.046,3,-8.087,7.8,0.5,0.5,0,120,0],[16.666,3,5.407,9.8,0.5,0.5,0,135,0],[13.5,3,17,10.5,0.5,5,0,0,0],[14.5,4,16.5,0.5,0.5,3.5,0,0,0],[12.8,3,11.5,9.8,0.5,0.5,0,0,0],[12.3,3,10.5,9.3,0.5,0.5,0,0,0],[11.8,3,9.5,8.8,0.5,0.5,0,0,0],[11.3,3,8.5,8.3,0.5,0.5,0,0,0],[10.95,3,7.5,7.95,0.5,0.5,0,0,0],[10.3,3,6.5,7.3,0.5,0.5,0,0,0],[9.8,3,5.5,6.8,0.5,0.5,0,0,0],[9.3,3,4.5,6.3,0.5,0.5,0,0,0],[8.8,3,3.5,5.8,0.5,0.5,0,0,0],[8.3,3,2.5,5.3,0.5,0.5,0,0,0],[7.75,3,1.5,4.75,0.5,0.5,0,0,0],[7.3,3,0.5,4.3,0.5,0.5,0,0,0],[6.8,3,-0.5,3.8,0.5,0.5,0,0,0],[6.3,3,-1.5,3.3,0.5,0.5,0,0,0],[6,3,-2.5,3,0.5,0.5,0,0,0],[5.7,3,-3.5,2.7,0.5,0.5,0,0,0],[5.45,3,-4.5,2.45,0.5,0.5,0,0,0],[5.15,3,-5.5,2.15,0.5,0.5,0,0,0],[4.85,3,-6.5,1.85,0.5,0.5,0,0,0],[4.55,3,-7.5,1.55,0.5,0.5,0,0,0],[4.3,3,-8.5,1.3,0.5,0.5,0,0,0],[4,3,-9.5,1,0.5,0.5,0,0,0],[3.7,3,-10.5,0.7,0.5,0.5,0,0,0],[0,3,23.1,1,1,0.5,0,0,0],[-14.5,4,16.5,0.5,0.5,3.5,0,0,0],[0,3,24.6,3,1,1,0,0,0],[1.5,5,24.6,0.5,1,0.5,0,0,0],[-1.5,5,24.6,0.5,1,0.5,0,0,0],[1.5,1.5,24.6,0.5,0.5,0.5,0,0,0],[-1.5,1.5,24.6,0.5,0.5,0.5,0,0,0]]},"rocket:missile":{sc:1,piv:[0,0,0],c:[[7.747,4.25,1.474,2,0.75,21.5,0,35,0],[15,4.25,14,2,0.75,5,0,0,0],[18,4.25,16.5,2,0.75,2.5,0,0,0],[11,4.25,11,2,0.75,8,0,0,0],[7,4.25,8,2,0.75,11,0,0,0],[3,4.25,6,2,0.75,14,0,0,0],[18,4.25,16.5,2,0.75,2.5,0,0,0],[-7,4.25,19.5,1.5,0.75,25.5,0,90,0],[-1,5,2.5,2,2,21.5,0,0,0],[-1,5.805,-20.253,1.5,1,1.5,7.5,0,0],[-1,4.243,-20.456,1.5,1,1.5,-7.5,0,0],[-0.195,5,-20.253,1.5,1,1.5,7.5,0,90],[-1.803,5,-20.261,1.5,1,1.5,-7.5,0,90],[24.5,4.5,21,0.5,2.5,2,0,0,0],[-2.5,8.5,14.5,0.5,1.5,0.5,0,0,0],[0.5,8.5,14.5,0.5,1.5,0.5,0,0,0],[-2.5,6,28.5,0.5,2,0.5,0,0,0],[-1,7.5,28.5,0.5,1,0.5,0,0,-90],[-1,4.5,28.5,0.5,1,0.5,0,0,-90],[0.5,6,28.5,0.5,2,0.5,0,0,0],[-1,9.5,14.5,0.5,1,0.5,0,0,-90],[-1,8.5,19.5,2,1.5,4.5,0,0,0],[-1,7.924,25.383,2,1,3,-22.5,0,0],[-1,6,26,2,2,2,0,0,0],[-26.5,4.5,21,0.5,2.5,2,0,0,0],[-9.747,4.25,1.474,2,0.75,21.5,0,-35,0],[-17,4.25,14,2,0.75,5,0,0,0],[-20,4.25,16.5,2,0.75,2.5,0,0,0],[-13,4.25,11,2,0.75,8,0,0,0],[-9,4.25,8,2,0.75,11,0,0,0],[-5,4.25,6,2,0.75,14,0,0,0]]},"rocket:missile2":{sc:1.2,piv:[0,0,0],c:[[4.895,8.1,2.753,0.45,0.1,0.2,0,-12.5,0],[6.587,8.1,1.61,3.85,0.1,0.55,0,-12.5,0],[7.975,8.1,2.326,2.65,0.1,0.45,0,-12.5,0],[-3.895,8.1,2.753,0.45,0.1,0.2,0,12.5,0],[-6.975,8.1,2.326,2.65,0.1,0.45,0,12.5,0],[-5.587,8.1,1.61,3.85,0.1,0.55,0,12.5,0],[0.5,8.4,4,1.3,0.2,3.1,0,0,0],[0.5,6.5,6,1.5,1.5,10,0,0,0],[0.5,8.1,0,1.5,0.1,4,0,0,0],[0.5,6.6,16.25,1.5,1.6,0.25,0,0,0],[0.5,6.65,16.65,1.4,1.45,0.15,0,0,0],[0.5,6.65,16.95,1.3,1.35,0.15,0,0,0],[0.5,6.65,17.2,1.2,1.25,0.1,0,0,0],[0.5,6.65,17.4,1.1,1.15,0.1,0,0,0],[0.5,6.65,17.6,1,1.05,0.1,0,0,0],[0.5,6.65,17.8,0.9,0.95,0.1,0,0,0],[0.5,6.65,18,0.8,0.85,0.1,0,0,0],[0.5,6.65,18.2,0.7,0.75,0.1,0,0,0],[0.5,6.65,18.4,0.6,0.65,0.1,0,0,0],[0.5,6.65,18.6,0.4,0.45,0.1,0,0,0],[0.5,6.6,-4.45,1.4,1.5,0.45,0,0,0],[0.5,6.6,-4.55,1.2,1.4,0.55,0,0,0],[0.5,6.6,-4.9,1.2,1.3,0.4,0,0,0],[0.5,6.6,-5.2,1,1.1,0.3,0,0,0],[0.5,6.6,-5.45,0.8,0.9,0.25,0,0,0],[0.5,6.6,-5.65,0.6,0.7,0.25,0,0,0],[0.5,6.6,-5.85,0.4,0.5,0.25,0,0,0],[0.5,6.6,-6.05,0.2,0.2,0.25,0,0,0],[0.5,8.1,13.85,1.5,0.1,2.15,0,0,0],[1.489,8.957,14.6,0.75,0.1,0.6,0,0,101.5],[-0.589,8.957,14.6,0.75,0.1,0.6,0,0,-101.5],[23.132,7.1,12.357,1,0.1,2.1,0,-67.5,0],[-22.856,3.785,12.243,0.5,0.1,2.1,-30,67.5,0],[23.856,3.785,12.243,0.5,0.1,2.1,-30,-67.5,0],[-22.132,7.1,12.357,1,0.1,2.1,0,67.5,0],[0.5,8.4,-0.2,0.4,0.2,0.3,0,0,0],[0.5,8.4,0.5,0.9,0.2,0.4,0,0,0],[0.5,4.15,9.55,1.1,0.85,3.45,0,0,0],[0.5,4.2,13.6,1.1,0.8,0.6,0,0,0],[0.5,4.45,14.6,1.1,0.55,0.4,0,0,0],[0.5,4.8,15.5,1.1,0.2,0.5,0,0,0],[0.5,4.9,16.35,1.1,0.1,0.35,0,0,0]]},"rocket:missile3":{sc:1,piv:[0,0,0],c:[[7.747,4.25,1.474,2,0.75,21.5,0,35,0],[15,4.25,14,2,0.75,5,0,0,0],[18,4.25,16.5,2,0.75,2.5,0,0,0],[11,4.25,11,2,0.75,8,0,0,0],[7,4.25,8,2,0.75,11,0,0,0],[3,4.25,6,2,0.75,14,0,0,0],[18,4.25,16.5,2,0.75,2.5,0,0,0],[-7,4.25,19.5,1.5,0.75,25.5,0,90,0],[-1,5,2.5,2,2,21.5,0,0,0],[0.5,5,26.5,0.5,2,0.5,0,0,0],[0.5,5,24.5,0.5,2,0.5,0,0,0],[-1.803,5,-20.261,1.5,1,1.5,-7.5,0,90],[24.5,4.5,21,0.5,2.5,2,0,0,0],[-1,5,25.5,1,1,1.5,0,0,0],[-26.5,4.5,21,0.5,2.5,2,0,0,0],[-9.747,4.25,1.474,2,0.75,21.5,0,-35,0],[-17,4.25,14,2,0.75,5,0,0,0],[-20,4.25,16.5,2,0.75,2.5,0,0,0],[-13,4.25,11,2,0.75,8,0,0,0],[-9,4.25,8,2,0.75,11,0,0,0],[-5,4.25,6,2,0.75,14,0,0,0],[-2.5,5,24.5,0.5,2,0.5,0,0,0],[-2.5,5,26.5,0.5,2,0.5,0,0,0],[-1,5.805,-20.253,1.5,1,1.5,7.5,0,0],[-1,4.243,-20.456,1.5,1,1.5,-7.5,0,0],[-0.195,5,-20.253,1.5,1,1.5,7.5,0,90]]},"rocket:missile5":{sc:1.5,piv:[0,0,0],c:[[0,3.65,-1.65,1.2,0.65,4.15,0,0,0],[0,4.8,0.35,1.2,0.5,2.15,0,0,0],[0,4.315,-3.679,1.2,0.5,2.062,14.04,0,0],[0,3.9,6.5,0.5,0.4,4,0,0,0],[0,4.75,3.45,0.65,0.45,0.65,0,0,0],[0,4.775,3.5,0.7,0.525,0.2,0,0,0],[-0.52,3.9,3.5,0.05,0.45,0.2,0,0,0],[0.52,3.9,3.5,0.05,0.45,0.2,0,0,0],[-6,5.525,0,6,0.225,1.8,0,0,0],[-12.693,5.597,0,0.7,0.2,1.6,0,0,8],[6,5.525,0,6,0.225,1.8,0,0,0],[12.693,5.597,0,0.7,0.2,1.6,0,0,-8],[0,6.414,9.72,0.15,1.8,1.3,-18,0,0],[0,4.425,9.4,4.2,0.175,1,0,0,0],[0,3.65,-6.1,0.55,0.55,0.3,0,0,0]]},"rocket:missile6":{sc:1.2,piv:[0,0,0],c:[[-2.5,0.5,0.5,0.5,0.5,13.5,0,0,0],[1.5,0.5,0.5,0.5,0.5,13.5,0,0,0],[-0.5,1.25,13.5,6.5,0.25,2.5,0,0,0],[-0.5,1.25,16.25,6.5,0.25,0.25,0,0,0],[-10,1.25,-4,8,0.25,3,0,0,0],[9,1.25,-4,8,0.25,3,0,0,0],[10,1.25,-0.75,7,0.25,0.25,0,0,0],[-0.5,1.25,-3.25,1.5,0.25,1.75,0,0,0],[-11,1.25,-0.75,7,0.25,0.25,0,0,0],[-0.5,1.05,-2.5,1.5,0.25,1.5,0,0,0],[-0.5,1.55,-2.1,0.5,0.25,1,0,0,0],[-0.2,1.55,-3.2,0.1,0.25,0.1,0,0,0],[-0.2,1.4,-3.3,0.1,0.1,0.6,0,0,0],[-0.8,1.55,-3.2,0.1,0.25,0.1,0,0,0],[-0.8,1.4,-3.4,0.1,0.1,0.1,0,0,0],[-0.6,1.4,-3.4,0.1,0.1,0.1,0,0,0],[-0.4,1.4,-3.4,0.1,0.1,0.1,0,0,0],[-0.5,1.9,-2.1,0.5,0.1,0.6,0,0,0],[-0.5,0.5,-12.45,1.5,0.35,0.35,0,0,0],[-0.5,0.5,-9.45,1.5,0.35,0.35,0,0,0],[-0.5,0.5,-6.45,1.5,0.35,0.35,0,0,0],[-0.5,0.5,-13.45,0.5,0.5,1.35,0,0,0],[-0.5,3.121,14.001,0.25,1.75,2.35,7.5,0,0],[-0.5,1,-8,1,1,2,0,0,0],[-0.5,1,-5.5,0.75,0.75,0.5,0,0,0],[-0.5,1,-10.5,0.75,0.75,0.5,0,0,0]]}};
const PC_STEP=.62,PC_R=.3;
const PCE=new Map(),PCP=new Map();
function pcRot(rx,ry,rz){function m(a,x){a=-a*Math.PI/180;const c=Math.cos(a),s=Math.sin(a);return x==="x"?[[1,0,0],[0,c,-s],[0,s,c]]:x==="y"?[[c,0,s],[0,1,0],[-s,0,c]]:[[c,-s,0],[s,c,0],[0,0,1]]}return pcMul(m(rz,"z"),pcMul(m(ry,"y"),m(rx,"x")))}
function pcMul(A,B){const r=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++)r[i][j]=A[i][0]*B[0][j]+A[i][1]*B[1][j]+A[i][2]*B[2][j];return r}
function pcMv(A,v){return[A[0][0]*v[0]+A[0][1]*v[1]+A[0][2]*v[2],A[1][0]*v[0]+A[1][1]*v[1]+A[1][2]*v[2],A[2][0]*v[0]+A[2][1]*v[1]+A[2][2]*v[2]]}
function pcPose(t,x,y,z,yaw,pit){
 const M=PCM[t],s=M.sc/16,ry=yaw*Math.PI/180,cy=Math.cos(ry),sy=Math.sin(ry),Rp=pcRot(pit,0,0),Yw=[[-cy,0,sy],[0,1,0],[-sy,0,-cy]],L=pcMul(Yw,Rp),out=[];
 for(let i=0;i<M.c.length;i++){
  const q=M.c[i],Rc=pcRot(q[6],q[7],q[8]),A=pcMul(L,Rc),rel=[q[0]-M.piv[0],q[1]-M.piv[1],q[2]-M.piv[2]],rp=pcMv(Rp,rel),cp=[(M.piv[0]+rp[0])*s,(M.piv[1]+rp[1])*s,(M.piv[2]+rp[2])*s],cw=pcMv(Yw,cp);
  const ax=[[A[0][0],A[1][0],A[2][0]],[A[0][1],A[1][1],A[2][1]],[A[0][2],A[1][2],A[2][2]]],h=[q[3]*s,q[4]*s,q[5]*s];
  const ext=Math.abs(ax[0][1])*h[0]+Math.abs(ax[1][1])*h[1]+Math.abs(ax[2][1])*h[2];
  out.push({c:[x+cw[0],y+cw[1],z+cw[2]],a:ax,h,top:y+cw[1]+ext,r:Math.hypot(h[0],h[1],h[2])});
 }
 return out;
}
function pcRayDown(ox,oy,oz,b){
 const dx=ox-b.c[0],dy=oy-b.c[1],dz=oz-b.c[2];let tmin=-1e9,tmax=1e9;
 for(let i=0;i<3;i++){const a=b.a[i],p=dx*a[0]+dy*a[1]+dz*a[2],d=-a[1],h=b.h[i];
  if(Math.abs(d)<1e-9){if(p<-h||p>h)return null}
  else{let t1=(-h-p)/d,t2=(h-p)/d;if(t1>t2){const t=t1;t1=t2;t2=t}if(t1>tmin)tmin=t1;if(t2<tmax)tmax=t2;if(tmin>tmax)return null}}
 return{tmin,tmax};
}
const PC_SM=[[0,0],[.27,.27],[.27,-.27],[-.27,.27],[-.27,-.27],[.27,0],[-.27,0],[0,.27],[0,-.27]];
function pcSolve(st,x,feet,z,boxes){
 const prev=st.py===void 0?feet:st.py;let S=null;const y0=feet<prev-.02?Math.max(feet+PC_STEP,prev+.02):feet+PC_STEP;
 for(const b of boxes){
  if(Math.abs(b.c[0]-x)>b.r+.5||Math.abs(b.c[2]-z)>b.r+.5||b.top<Math.min(feet,prev)-1.5||b.c[1]-b.r>y0+.1)continue;
  for(const o of PC_SM){const r=pcRayDown(x+o[0],y0,z+o[1],b);if(r&&r.tmin>=0){const sy=y0-r.tmin;if(S===null||sy>S)S=sy}}
 }
 let stand=!1,ny=feet;
 if(S!==null){
  const dy=feet-prev,above=prev>=S-.06,up=S-feet;
  if(feet<=S+.04&&dy<=.02&&(above||up<=PC_STEP)){
   stand=!0;
   let hold=st.hold===void 0?S:st.hold;
   hold+=(S-hold)*.5;
   st.hold=hold;
   if(feet<hold-.012)ny=feet+(hold-feet)*.55;
  }
 }else st.hold=void 0;
 st.py=ny;
 return{y:ny,stand};
}
function pcReg(e){if(!PCM[e.typeId]||PCE.has(e.id))return;PCE.set(e.id,{e,k:"",b:null})}
g.afterEvents.entitySpawn.subscribe(ev=>{try{const s=ev.entity;if(s&&PCM[s.typeId])P.runTimeout(()=>{try{if(s.isValid())pcReg(s)}catch{}},3)}catch{}});
P.runInterval(()=>{try{for(const dn of["overworld","nether","the_end"]){const dm=g.getDimension(dn);for(const t in PCM)for(const s of dm.getEntities({type:t}))pcReg(s)}}catch{}},60);
P.runInterval(()=>{try{
 if(!PCE.size)return;
 const tick=P.currentTick,live=[];
 for(const[id,r]of PCE){let ok=!1;try{ok=r.e.isValid()}catch{}if(!ok){PCE.delete(id);continue}live.push(r)}
 for(const pl of g.getAllPlayers()){
  try{
   if(pl.isFlying)continue;
   const l=pl.location,did=pl.dimension.id;let st=PCP.get(pl.id);if(!st){st={py:l.y,stand:0,jcd:0};PCP.set(pl.id,st)}
   const boxes=[];
   for(const r of live){
    const e=r.e;if(e.dimension.id!==did)continue;const el=e.location;if(Math.abs(el.x-l.x)>9||Math.abs(el.z-l.z)>9)continue;
    try{if(e.getDynamicProperty("is_launched"))continue}catch{}
    const ro=e.getRotation(),k=el.x.toFixed(3)+"|"+el.y.toFixed(3)+"|"+el.z.toFixed(3)+"|"+ro.y.toFixed(1)+"|"+ro.x.toFixed(1);
    if(r.k!==k){r.b=pcPose(e.typeId,el.x,el.y,el.z,ro.y,ro.x);r.k=k}
    for(const b of r.b)boxes.push(b);
   }
   if(!boxes.length){st.py=l.y;st.hold=void 0;st.stand=Math.max(0,st.stand-1);continue}
   let res=pcSolve(st,l.x,l.y,l.z,boxes);
   const gY=dbgGroundY(pl.dimension,l.x,l.z,Math.max(l.y,res.y)+2);
   if(gY!==null&&res.y<gY+.02){res={y:Math.max(l.y,gY),stand:!1};st.py=res.y;st.hold=void 0}
   if(Math.abs(res.y-l.y)>5e-3){try{pl.teleport({x:l.x,y:res.y,z:l.z})}catch{}}
   if(res.stand)st.stand=4;else st.stand=Math.max(0,st.stand-1);
   let jmp=!1;try{jmp=!!pl.isJumping}catch{}
   if(jmp&&st.stand>0&&tick>=st.jcd){try{pl.applyKnockback(0,0,0,.42)}catch{}st.jcd=tick+9;st.stand=0}
  }catch{}
 }
}catch{}},1);
