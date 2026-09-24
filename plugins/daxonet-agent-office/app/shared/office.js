// Shared office renderer: floor plan, furniture, pathing, sprites, day/night.
// Apps drive it with upsert()/say()/remove(); the office only animates.

export const ROOM_IDS = ["DESK_A", "DESK_B", "MEETING", "DESK_C", "PANTRY", "RECEPTION"];

const CORRIDOR = { y0: 0.44, y1: 0.56 };
const DOOR_W = 30;

const ROOM_GEOMETRY = {
  DESK_A:    { x:0.015, y:0.08, w:0.300, h:0.36, door:{side:"bottom", at:0.50}, floor:"carpet", base:"#0e1a2a" },
  DESK_B:    { x:0.315, y:0.08, w:0.345, h:0.36, door:{side:"bottom", at:0.50}, floor:"carpet", base:"#170f24" },
  MEETING:   { x:0.660, y:0.08, w:0.325, h:0.36, door:{side:"bottom", at:0.22}, floor:"carpet", base:"#131430", glass:true },
  DESK_C:    { x:0.015, y:0.56, w:0.335, h:0.40, door:{side:"top",    at:0.50}, floor:"carpet", base:"#19150c" },
  PANTRY:    { x:0.350, y:0.56, w:0.315, h:0.40, door:{side:"top",    at:0.50}, floor:"tile",   base:"#18202e" },
  RECEPTION: { x:0.665, y:0.56, w:0.320, h:0.40, door:{side:"top",    at:0.30}, floor:"wood",   base:"#1a1720", entrance:0.64 }
};

const DEFAULT_ROOMS = {
  DESK_A:    { label:"SUPPORT DESK",    tint:"#00fff2", desk:"headset" },
  DESK_B:    { label:"ENGINEERING BAY", tint:"#ff2ec4", desk:"dual" },
  MEETING:   { label:"MEETING ROOM",    tint:"#7c9bff" },
  DESK_C:    { label:"ANALYTICS HUB",   tint:"#ffb000", desk:"dual" },
  PANTRY:    { label:"PANTRY",          tint:"#7cff6b" },
  RECEPTION: { label:"RECEPTION",       tint:"#00fff2" }
};

const DESK_GRID = {
  DESK_A: { cols:3, rows:2, padL:28, padR:30 },
  DESK_B: { cols:3, rows:2, padL:24, padR:34 },
  DESK_C: { cols:3, rows:2, padL:20, padR:20 }
};

const DEFAULT_CHATTER = [
  "sup", "got a sec?", "ping me l8r", "long shift huh", "build's green btw",
  "coffee run?", "status?", "all good here", "brb", "heads down",
  "same tbh", "nice one", "o7", "on it", "lunch?", "meeting in 5"
];

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------
export function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function hexToRgba(hex, a){
  const v = hex.replace("#", "");
  return `rgba(${parseInt(v.slice(0,2),16)},${parseInt(v.slice(2,4),16)},${parseInt(v.slice(4,6),16)},${a})`;
}
function rr(c, x, y, w, h, r){
  r = Math.max(0, Math.min(r, w/2, h/2));
  c.beginPath();
  c.moveTo(x+r, y);
  c.arcTo(x+w, y, x+w, y+h, r);
  c.arcTo(x+w, y+h, x, y+h, r);
  c.arcTo(x, y+h, x, y, r);
  c.arcTo(x, y, x+w, y, r);
  c.closePath();
}
function line(c, x1, y1, x2, y2){ c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
function seeded(n){ const x = Math.sin(n*127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
function truncate(s, n){ s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ------------------------------------------------------------
// office
// ------------------------------------------------------------
export function createOffice(opts){
  const canvas = opts.canvas;
  const ctx = canvas.getContext("2d");
  const bg = document.createElement("canvas");
  const bctx = bg.getContext("2d");
  const rooms = {};
  ROOM_IDS.forEach(id => { rooms[id] = Object.assign({}, DEFAULT_ROOMS[id], (opts.rooms || {})[id] || {}); });
  const brand = opts.brand || "DAXONET";
  const chatter = opts.ambientChatter === false ? null : (opts.chatterLines || DEFAULT_CHATTER);
  const onSelect = opts.onSelect || function(){};

  let W = 0, H = 0;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let L = null;
  const bodies = new Map();
  let selectedId = null;
  let hourOverride = null;
  let nightAmt = 0;
  let last = performance.now();

  // ---------------- layout ----------------
  function buildLayout(){
    L = { rooms:{}, seats:{}, spots:{}, lanes:{}, desks:[], statics:[], racks:[], dyn:{}, corridor:null, entrance:null };
    const cy0 = CORRIDOR.y0*H, cy1 = CORRIDOR.y1*H;
    L.corridor = { x:0.015*W, y:cy0, w:0.970*W, h:cy1 - cy0, cy:(cy0 + cy1)/2 };
    ROOM_IDS.forEach(id => {
      const g = ROOM_GEOMETRY[id];
      const r = { id, g, cfg:rooms[id], x:g.x*W, y:g.y*H, w:g.w*W, h:g.h*H };
      r.doorX = r.x + r.w*g.door.at;
      if (g.door.side === "bottom"){ r.wallY = r.y + r.h; r.inner = { x:r.doorX, y:r.wallY - 18 }; }
      else { r.wallY = r.y; r.inner = { x:r.doorX, y:r.wallY + 18 }; }
      r.outer = { x:r.doorX, y:L.corridor.cy };
      L.rooms[id] = r;
      L.spots[id] = [];
    });
    layoutDeskRooms();
    layoutMeeting();
    layoutPantry();
    layoutReception();
    layoutCorridor();
    renderStatic();
  }
  function addStatic(it){ L.statics.push(it); return it; }

  function layoutDeskRooms(){
    Object.keys(DESK_GRID).forEach(id => {
      const r = L.rooms[id], g = DESK_GRID[id], cfg = rooms[id];
      const doorTop = r.g.door.side === "top";
      const padTop = doorTop ? 40 : 30, padBottom = doorTop ? 18 : 34;
      const cellW = Math.max(1, r.w - g.padL - g.padR) / g.cols;
      const cellH = Math.max(1, r.h - padTop - padBottom) / g.rows;
      const seats = [];
      for (let row = 0; row < g.rows; row++){
        for (let col = 0; col < g.cols; col++){
          const cx = r.x + g.padL + cellW*(col + 0.5);
          const cyc = r.y + padTop + cellH*(row + 0.5);
          const dw = Math.min(40, cellW*0.72), dh = Math.min(17, cellH*0.34);
          const deskY = cyc - 6, idx = seats.length;
          L.desks.push({ room:id, idx, x:cx, y:deskY, w:dw, h:dh, color:cfg.tint,
                         dual: cfg.desk !== "headset", headset: cfg.desk === "headset",
                         accessory: Math.floor(seeded(idx + id.charCodeAt(5)*7) * 3) });
          seats.push({ x:cx, y:deskY + dh/2 + 8, face:-Math.PI/2 });
        }
      }
      L.seats[id] = seats;
      const aisles = [];
      for (let k = 1; k < g.cols; k++) aisles.push(r.x + g.padL + cellW*k);
      L.lanes[id] = { type:"aisles", xs:aisles };

      if (id === "DESK_A"){
        addStatic({ type:"board", x:r.x + 7, y:r.y + 30, h:r.h*0.46, color:cfg.tint });
        addStatic({ type:"cabinet", x:r.x + r.w - 22, y:r.y + 22 });
        addStatic({ type:"cabinet", x:r.x + r.w - 22, y:r.y + 44 });
        L.spots[id].push({ x:r.x + r.w - 34, y:r.y + 40, face:0, tag:"cabinet" });
        addStatic({ type:"plant", x:r.x + 14, y:r.y + r.h - 14 });
        addStatic({ type:"plant", x:r.x + r.w - 14, y:r.y + r.h - 14 });
      } else if (id === "DESK_B"){
        const k1 = addStatic({ type:"rack", x:r.x + r.w - 14, y:r.y + 24, color:cfg.tint });
        const k2 = addStatic({ type:"rack", x:r.x + r.w - 14, y:r.y + 60, color:cfg.tint });
        L.racks.push(k1, k2);
        L.spots[id].push({ x:r.x + r.w - 28, y:r.y + 40, face:0, tag:"rack" });
        L.spots[id].push({ x:r.x + r.w - 28, y:r.y + 76, face:0, tag:"rack" });
        addStatic({ type:"whiteboard", x:r.x + 5, y:r.y + 30, h:r.h*0.42 });
        addStatic({ type:"plant", x:r.x + 14, y:r.y + r.h - 14 });
        addStatic({ type:"bin", x:r.x + r.w - 16, y:r.y + r.h - 14 });
      } else if (id === "DESK_C"){
        L.dyn.kpi = addStatic({ type:"kpi", x:r.x + r.w - 54, y:r.y + 8, w:44, h:24 });
        L.spots[id].push({ x:r.x + r.w - 32, y:r.y + 42, face:-Math.PI/2, tag:"screen" });
        addStatic({ type:"plant", x:r.x + 14, y:r.y + r.h - 14 });
        addStatic({ type:"cabinet", x:r.x + r.w - 22, y:r.y + r.h - 26 });
        addStatic({ type:"printer", x:r.x + 30, y:r.y + 20 });
      }
    });
  }

  function layoutMeeting(){
    const r = L.rooms.MEETING;
    const tx = r.x + r.w*0.52, ty = r.y + r.h*0.50 + 2;
    const tw = r.w*0.50, th = Math.min(r.h*0.28, 38);
    addStatic({ type:"table", x:tx - tw/2, y:ty - th/2, w:tw, h:th });
    L.lanes.MEETING = { type:"lane", x:tx - tw/2 - 22 };
    const n = Math.max(3, Math.floor(tw/26)), spots = L.spots.MEETING;
    for (let i = 0; i < n; i++){
      const x = tx - tw/2 + tw*(i + 0.5)/n;
      spots.push({ x, y:ty - th/2 - 9, face: Math.PI/2, seat:"chair" });
      spots.push({ x, y:ty + th/2 + 9, face:-Math.PI/2, seat:"chair" });
    }
    spots.push({ x:tx - tw/2 - 10, y:ty, face:0, seat:"chair" });
    spots.push({ x:tx + tw/2 + 10, y:ty, face:Math.PI, seat:"chair", tag:"head" });
    L.dyn.tv = addStatic({ type:"tv", x:r.x + r.w - 8, y:ty - r.h*0.2, w:4, h:r.h*0.4 });
    addStatic({ type:"whiteboard", x:r.x + 5, y:ty - r.h*0.2, h:r.h*0.4 });
    addStatic({ type:"plant", x:r.x + r.w - 16, y:r.y + 18 });
    addStatic({ type:"plant", x:r.x + r.w - 16, y:r.y + r.h - 16 });
  }

  function layoutPantry(){
    const r = L.rooms.PANTRY, spots = L.spots.PANTRY;
    L.lanes.PANTRY = { type:"lane", x:r.x + r.w*0.41 };
    const x0 = r.x + 8, x1 = r.x + r.w*0.66, cy = r.y + r.h - 20, ch = 12;
    addStatic({ type:"counter", x:x0, y:cy, w:x1 - x0, h:ch });
    const sinkX = x0 + (x1 - x0)*0.18, coffX = x0 + (x1 - x0)*0.46, microX = x0 + (x1 - x0)*0.76;
    addStatic({ type:"sink", x:sinkX, y:cy + ch/2 });
    L.dyn.coffee = addStatic({ type:"coffee", x:coffX, y:cy + ch/2 });
    addStatic({ type:"microwave", x:microX, y:cy + ch/2 });
    spots.push({ x:sinkX, y:cy - 10, face:Math.PI/2, seat:null });
    spots.push({ x:coffX, y:cy - 10, face:Math.PI/2, seat:null, tag:"coffee" });
    spots.push({ x:microX, y:cy - 10, face:Math.PI/2, seat:null });
    addStatic({ type:"fridge", x:r.x + r.w - 26, y:r.y + r.h - 32, w:18, h:24 });
    L.dyn.vending = addStatic({ type:"vending", x:r.x + r.w - 21, y:r.y + 30, w:14, h:32 });
    addStatic({ type:"water", x:r.doorX + 38, y:r.y + 15 });
    addStatic({ type:"bin", x:r.x + 14, y:r.y + 16 });
    [[0.26, 0.46], [0.56, 0.46]].forEach(p => {
      const tx = r.x + r.w*p[0], ty = r.y + r.h*p[1];
      addStatic({ type:"roundtable", x:tx, y:ty, r:11 });
      [Math.PI*0.15, Math.PI*0.85, Math.PI*1.5].forEach(ang => {
        spots.push({ x:tx + Math.cos(ang)*18, y:ty + Math.sin(ang)*18, face:ang + Math.PI, seat:"stool" });
      });
    });
  }

  function layoutReception(){
    const r = L.rooms.RECEPTION, spots = L.spots.RECEPTION;
    const fx = r.x + r.w*0.40, fy = r.y + r.h*0.52;
    addStatic({ type:"frontdesk", x:fx, y:fy });
    spots.push({ x:fx, y:fy + 4, face:Math.PI/2, seat:"chair", tag:"desk" });
    const sofa = addStatic({ type:"sofa", x:r.x + r.w - 24, y:r.y + r.h*0.24, w:14, h:r.h*0.46 });
    for (let i = 0; i < 3; i++) spots.push({ x:sofa.x + 5, y:sofa.y + sofa.h*(i + 0.5)/3, face:Math.PI, seat:null });
    L.lanes.RECEPTION = { type:"reception", deskX:fx, chairY:fy + 4, sofaLaneX:sofa.x - 5 };
    addStatic({ type:"ctable", x:r.x + r.w - 50, y:r.y + r.h*0.36, w:16, h:r.h*0.22 });
    addStatic({ type:"logo", x:r.x + r.w - 12, y:r.y + 18 });
    addStatic({ type:"plant", x:r.x + 14, y:r.y + r.h - 14 });
    addStatic({ type:"plant", x:r.x + r.w - 14, y:r.y + r.h - 14 });
    addStatic({ type:"plant", x:r.x + r.w - 14, y:r.y + r.h*0.14 });
    const ex = r.x + r.w*r.g.entrance;
    L.entrance = { x:ex, y:r.y + r.h - 14 };
    L.dyn.mat = addStatic({ type:"mat", x:ex, y:r.y + r.h - 8 });
  }

  function layoutCorridor(){
    const c = L.corridor;
    addStatic({ type:"printer", x:0.33*W, y:c.y + 10 });
    addStatic({ type:"notice", x:0.88*W, y:c.y + 3, w:44 });
    addStatic({ type:"water", x:0.62*W, y:c.y + c.h - 10 });
    addStatic({ type:"extinguisher", x:0.42*W, y:c.y + c.h - 7 });
    addStatic({ type:"plant", x:c.x + 12, y:c.cy });
    addStatic({ type:"plant", x:c.x + c.w - 12, y:c.cy });
  }

  // ---------------- static render ----------------
  const WALL = "rgba(150,175,255,0.62)", CHAIR = "#2a3352";

  function renderStatic(){
    bg.width = Math.floor(W*DPR); bg.height = Math.floor(H*DPR);
    const c = bctx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    const k = L.corridor;
    c.fillStyle = "#0c1020"; c.fillRect(k.x, k.y, k.w, k.h);
    c.fillStyle = "rgba(124,155,255,0.05)"; c.fillRect(k.x + 20, k.cy - 7, k.w - 40, 14);
    c.strokeStyle = "rgba(124,155,255,0.10)"; c.lineWidth = 1; c.setLineDash([10, 12]);
    line(c, k.x + 24, k.cy, k.x + k.w - 24, k.cy); c.setLineDash([]);

    ROOM_IDS.forEach(id => drawFloor(c, L.rooms[id]));
    L.desks.forEach(d => drawDesk(c, d));
    Object.keys(L.seats).forEach(id => L.seats[id].forEach(s => drawChair(c, s.x, s.y, s.face, 5.5)));
    Object.keys(L.spots).forEach(id => L.spots[id].forEach(s => {
      if (s.seat === "chair") drawChair(c, s.x, s.y, s.face, 5.5);
      else if (s.seat === "stool") drawStool(c, s.x, s.y);
    }));
    L.statics.forEach(it => drawStaticItem(c, it));
    ROOM_IDS.forEach(id => drawWalls(c, L.rooms[id]));
    c.save(); c.lineWidth = 3; c.strokeStyle = WALL; c.shadowColor = "rgba(124,155,255,0.55)"; c.shadowBlur = 4;
    line(c, k.x, k.y, k.x, k.y + k.h); line(c, k.x + k.w, k.y, k.x + k.w, k.y + k.h); c.restore();
    ROOM_IDS.forEach(id => {
      const r = L.rooms[id];
      c.save();
      c.font = "10px 'Share Tech Mono', monospace";
      c.fillStyle = hexToRgba(r.cfg.tint, 0.85); c.fillRect(r.x + 8, r.y + 7, 3, 9);
      c.fillStyle = "rgba(170,195,225,0.9)"; c.fillText(r.cfg.label, r.x + 15, r.y + 15);
      c.restore();
    });
  }

  function drawFloor(c, r){
    const g = r.g;
    c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
    c.fillStyle = g.base; c.fillRect(r.x, r.y, r.w, r.h);
    if (g.floor === "tile"){
      const s = 16;
      for (let ty = r.y; ty < r.y + r.h; ty += s) for (let tx = r.x; tx < r.x + r.w; tx += s){
        if ((Math.floor((tx - r.x)/s) + Math.floor((ty - r.y)/s)) % 2 === 0){ c.fillStyle = "rgba(255,255,255,0.035)"; c.fillRect(tx, ty, s, s); }
      }
      c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 0.5;
      for (let gx = r.x; gx < r.x + r.w; gx += s) line(c, gx, r.y, gx, r.y + r.h);
      for (let gy = r.y; gy < r.y + r.h; gy += s) line(c, r.x, gy, r.x + r.w, gy);
    } else if (g.floor === "wood"){
      let row = 0;
      for (let py = r.y; py < r.y + r.h; py += 9, row++){
        c.fillStyle = row % 2 ? "rgba(255,220,180,0.025)" : "rgba(0,0,0,0.08)"; c.fillRect(r.x, py, r.w, 9);
        c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 0.5; line(c, r.x, py, r.x + r.w, py);
        for (let sx = r.x + (row*37) % 60; sx < r.x + r.w; sx += 60) line(c, sx, py, sx, py + 9);
      }
    } else {
      c.fillStyle = "rgba(255,255,255,0.012)";
      for (let cy = r.y; cy < r.y + r.h; cy += 4) c.fillRect(r.x, cy, r.w, 1);
    }
    const gr = c.createRadialGradient(r.x + r.w/2, r.y + r.h/2, 0, r.x + r.w/2, r.y + r.h/2, Math.max(r.w, r.h)*0.7);
    gr.addColorStop(0, hexToRgba(r.cfg.tint, 0.07)); gr.addColorStop(1, hexToRgba(r.cfg.tint, 0));
    c.fillStyle = gr; c.fillRect(r.x, r.y, r.w, r.h);
    c.restore();
  }

  function drawWalls(c, r){
    const g = r.g, half = DOOR_W/2, by = r.y + r.h;
    c.save(); c.lineCap = "square"; c.lineWidth = 3; c.strokeStyle = WALL;
    c.shadowColor = "rgba(124,155,255,0.55)"; c.shadowBlur = 4;
    if (g.door.side === "top"){ line(c, r.x, r.y, r.doorX - half, r.y); line(c, r.doorX + half, r.y, r.x + r.w, r.y); }
    else line(c, r.x, r.y, r.x + r.w, r.y);
    if (g.door.side === "bottom"){
      if (g.glass){
        c.save(); c.shadowBlur = 0; c.lineWidth = 2; c.strokeStyle = "rgba(0,255,242,0.55)"; c.setLineDash([6, 3]);
        line(c, r.x, by, r.doorX - half, by); line(c, r.doorX + half, by, r.x + r.w, by);
        c.setLineDash([]); c.fillStyle = "rgba(0,255,242,0.05)"; c.fillRect(r.x, by - 3, r.w, 3); c.restore();
      } else { line(c, r.x, by, r.doorX - half, by); line(c, r.doorX + half, by, r.x + r.w, by); }
    } else if (g.entrance){
      const ex = r.x + r.w*g.entrance;
      line(c, r.x, by, ex - 20, by); line(c, ex + 20, by, r.x + r.w, by);
    } else line(c, r.x, by, r.x + r.w, by);
    line(c, r.x, r.y, r.x, by); line(c, r.x + r.w, r.y, r.x + r.w, by);
    c.restore();

    const hx = r.doorX - half, rad = DOOR_W*0.85;
    c.save(); c.strokeStyle = "rgba(150,175,255,0.35)"; c.lineWidth = 1; c.setLineDash([2, 3]); c.beginPath();
    if (g.door.side === "bottom") c.arc(hx, r.wallY, rad, -Math.PI/2, 0); else c.arc(hx, r.wallY, rad, 0, Math.PI/2);
    c.stroke(); c.setLineDash([]); c.lineWidth = 1.6; c.strokeStyle = "rgba(150,175,255,0.6)";
    line(c, hx, r.wallY, hx, r.wallY + (g.door.side === "bottom" ? -rad : rad)); c.restore();

    if (g.entrance){
      const ex = r.x + r.w*g.entrance;
      c.save(); c.font = "9px 'Share Tech Mono', monospace"; c.fillStyle = "rgba(0,255,242,0.75)"; c.textAlign = "center";
      c.fillText("ENTRANCE", ex, by + 12); c.strokeStyle = "rgba(0,255,242,0.5)"; c.lineWidth = 1;
      line(c, ex - 20, by, ex - 20, by + 4); line(c, ex + 20, by, ex + 20, by + 4); c.restore();
    }
  }

  function drawChair(c, x, y, face, rad){
    c.beginPath(); c.arc(x, y, rad, 0, Math.PI*2); c.fillStyle = CHAIR; c.fill();
    c.strokeStyle = "rgba(255,255,255,0.08)"; c.lineWidth = 1; c.stroke();
    const back = face + Math.PI;
    c.beginPath(); c.arc(x, y, rad + 0.5, back - 0.9, back + 0.9); c.strokeStyle = "#3d4870"; c.lineWidth = 2.6; c.stroke();
  }
  function drawStool(c, x, y){
    c.beginPath(); c.arc(x, y, 4, 0, Math.PI*2); c.fillStyle = "#303a5c"; c.fill();
    c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 1; c.stroke();
  }
  function monitorRects(d){
    const my = d.y - d.h/2 + 3;
    if (d.dual){
      const mw = d.w*0.30;
      return [{ x:d.x - d.w*0.17 - mw/2, y:my - 1.5, w:mw, h:3 }, { x:d.x + d.w*0.17 - mw/2, y:my - 1.5, w:mw, h:3 }];
    }
    const sw = d.w*0.44;
    return [{ x:d.x - sw/2, y:my - 1.5, w:sw, h:3 }];
  }
  function drawDesk(c, d){
    rr(c, d.x - d.w/2, d.y - d.h/2, d.w, d.h, 2); c.fillStyle = "#1b2238"; c.fill();
    c.strokeStyle = "rgba(255,255,255,0.10)"; c.lineWidth = 1; c.stroke();
    monitorRects(d).forEach(m => {
      c.fillStyle = "#070a14"; c.fillRect(m.x, m.y, m.w, m.h);
      c.fillStyle = "#2b3350"; c.fillRect(m.x + m.w/2 - 1.5, m.y + m.h, 3, 2);
    });
    c.fillStyle = "#2b3350"; c.fillRect(d.x - d.w*0.18, d.y + 1.5, d.w*0.36, 3);
    c.beginPath(); c.arc(d.x + d.w*0.30, d.y + 3, 1.4, 0, Math.PI*2); c.fill();
    if (d.headset){ c.beginPath(); c.arc(d.x - d.w*0.36, d.y + 1, 3, Math.PI, Math.PI*2); c.strokeStyle = hexToRgba(d.color, 0.7); c.lineWidth = 1.2; c.stroke(); }
    if (d.accessory === 0){ c.beginPath(); c.arc(d.x + d.w*0.40, d.y - 2, 1.9, 0, Math.PI*2); c.fillStyle = "#8a5a3a"; c.fill(); }
    else if (d.accessory === 1){ c.fillStyle = "rgba(220,230,255,0.28)"; c.fillRect(d.x + d.w*0.30, d.y - d.h/2 + 2, 6, 5); }
    else { c.beginPath(); c.arc(d.x + d.w*0.40, d.y - 2, 2.3, 0, Math.PI*2); c.fillStyle = "rgba(90,220,120,0.7)"; c.fill(); }
  }
  function drawPlant(c, x, y){
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI*2); c.fillStyle = "#3a2a1c"; c.fill();
    for (let i = 0; i < 6; i++){
      const a = i/6*Math.PI*2;
      c.beginPath(); c.arc(x + Math.cos(a)*4, y + Math.sin(a)*4, 3.4, 0, Math.PI*2);
      c.fillStyle = i % 2 ? "rgba(90,220,120,0.75)" : "rgba(60,180,100,0.8)"; c.fill();
    }
    c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI*2); c.fillStyle = "rgba(124,255,107,0.8)"; c.fill();
  }

  function drawStaticItem(c, it){
    switch (it.type){
      case "plant": drawPlant(c, it.x, it.y); break;
      case "board": {
        rr(c, it.x, it.y, 6, it.h, 1); c.fillStyle = "#0d1322"; c.fill(); c.strokeStyle = hexToRgba(it.color, 0.6); c.lineWidth = 1; c.stroke();
        const cols = ["#00fff2", "#ffb000", "#ff2ec4"];
        for (let i = 0; i < 7; i++){ c.fillStyle = hexToRgba(cols[i%3], 0.7); c.fillRect(it.x + 1.5, it.y + 4 + i*(it.h - 8)/7, 3, 3); }
        break;
      }
      case "whiteboard":
        rr(c, it.x, it.y, 5, it.h, 1); c.fillStyle = "rgba(220,235,255,0.55)"; c.fill();
        c.strokeStyle = "rgba(255,255,255,0.4)"; c.lineWidth = 1; c.stroke();
        c.fillStyle = "rgba(255,46,196,0.8)"; c.fillRect(it.x + 1.5, it.y + it.h*0.3, 2, 2);
        c.fillStyle = "rgba(0,160,255,0.8)"; c.fillRect(it.x + 1.5, it.y + it.h*0.6, 2, 2);
        break;
      case "cabinet":
        rr(c, it.x, it.y, 14, 18, 1.5); c.fillStyle = "#262c40"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 1; c.stroke();
        c.strokeStyle = "rgba(0,0,0,0.4)"; line(c, it.x + 2, it.y + 6, it.x + 12, it.y + 6); line(c, it.x + 2, it.y + 12, it.x + 12, it.y + 12);
        break;
      case "bin":
        c.beginPath(); c.arc(it.x, it.y, 4, 0, Math.PI*2); c.fillStyle = "#1e2436"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.18)"; c.lineWidth = 1; c.stroke();
        break;
      case "printer":
        rr(c, it.x - 9, it.y - 6, 18, 12, 2); c.fillStyle = "#262e46"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = 1; c.stroke();
        c.fillStyle = "rgba(230,240,255,0.55)"; c.fillRect(it.x - 5, it.y - 3, 10, 3);
        c.fillStyle = "rgba(124,255,107,0.9)"; c.fillRect(it.x + 5, it.y + 2, 2, 2);
        break;
      case "rack":
        rr(c, it.x - 6, it.y, 12, 30, 2); c.fillStyle = "#0a0e1a"; c.fill(); c.strokeStyle = hexToRgba(it.color, 0.55); c.lineWidth = 1; c.stroke();
        c.strokeStyle = "rgba(255,255,255,0.06)"; for (let s = 1; s < 6; s++) line(c, it.x - 5, it.y + s*5, it.x + 5, it.y + s*5);
        break;
      case "kpi":
        rr(c, it.x, it.y, it.w, it.h, 2); c.fillStyle = "#0a0e1a"; c.fill(); c.strokeStyle = "rgba(255,176,0,0.6)"; c.lineWidth = 1; c.stroke();
        break;
      case "table":
        rr(c, it.x, it.y, it.w, it.h, 8); c.fillStyle = "#2b2340"; c.fill(); c.strokeStyle = "rgba(124,155,255,0.45)"; c.lineWidth = 1; c.stroke();
        rr(c, it.x + 4, it.y + 4, it.w - 8, it.h - 8, 6); c.strokeStyle = "rgba(255,255,255,0.05)"; c.stroke();
        c.beginPath(); c.moveTo(it.x + it.w/2, it.y + it.h/2 - 4); c.lineTo(it.x + it.w/2 + 4, it.y + it.h/2 + 3); c.lineTo(it.x + it.w/2 - 4, it.y + it.h/2 + 3); c.closePath();
        c.fillStyle = "#0b0f1c"; c.fill();
        c.fillStyle = "rgba(220,230,255,0.25)"; c.fillRect(it.x + it.w*0.2, it.y + it.h*0.3, 8, 6); c.fillRect(it.x + it.w*0.72, it.y + it.h*0.55, 8, 6);
        break;
      case "tv":
        rr(c, it.x, it.y, it.w, it.h, 1); c.fillStyle = "#0b0f1c"; c.fill(); c.strokeStyle = "rgba(124,155,255,0.5)"; c.lineWidth = 1; c.stroke();
        break;
      case "counter":
        rr(c, it.x, it.y, it.w, it.h, 2); c.fillStyle = "#222a3e"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 1; c.stroke();
        c.fillStyle = "rgba(255,255,255,0.05)"; c.fillRect(it.x + 2, it.y + 1, it.w - 4, 2);
        break;
      case "sink":
        rr(c, it.x - 6, it.y - 4, 12, 8, 2); c.fillStyle = "#3a4460"; c.fill();
        rr(c, it.x - 4.5, it.y - 2.5, 9, 5, 1.5); c.fillStyle = "#566285"; c.fill();
        c.fillStyle = "#8a96b8"; c.fillRect(it.x - 0.5, it.y - 5.5, 1, 2);
        break;
      case "coffee":
        rr(c, it.x - 5, it.y - 5, 10, 10, 2); c.fillStyle = "#101420"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.18)"; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.arc(it.x, it.y + 1, 1.8, 0, Math.PI*2); c.fillStyle = "#e8e0d4"; c.fill();
        break;
      case "microwave":
        rr(c, it.x - 7, it.y - 4, 14, 8, 1); c.fillStyle = "#1a1f2d"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.15)"; c.lineWidth = 1; c.stroke();
        c.fillStyle = "rgba(124,155,255,0.25)"; c.fillRect(it.x - 5, it.y - 2, 7, 4);
        break;
      case "fridge":
        rr(c, it.x, it.y, it.w, it.h, 2); c.fillStyle = "#2e3650"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.2)"; c.lineWidth = 1; c.stroke();
        c.strokeStyle = "rgba(0,0,0,0.4)"; line(c, it.x + 1, it.y + it.h*0.38, it.x + it.w - 1, it.y + it.h*0.38);
        c.fillStyle = "rgba(200,210,230,0.5)"; c.fillRect(it.x + 2, it.y + 3, 1.5, 5); c.fillRect(it.x + 2, it.y + it.h*0.45, 1.5, 6);
        break;
      case "vending": {
        rr(c, it.x, it.y, it.w, it.h, 2); c.fillStyle = "#140a1c"; c.fill(); c.strokeStyle = "rgba(255,46,196,0.5)"; c.lineWidth = 1; c.stroke();
        const pc = ["#00fff2", "#ff2ec4", "#ffb000", "#7cff6b"];
        for (let vy = 0; vy < 5; vy++) for (let vx = 0; vx < 2; vx++){ c.fillStyle = hexToRgba(pc[(vy + vx)%4], 0.6); c.fillRect(it.x + 3 + vx*5, it.y + 4 + vy*5, 3, 3); }
        break;
      }
      case "water":
        c.beginPath(); c.arc(it.x, it.y, 4.5, 0, Math.PI*2); c.fillStyle = "rgba(120,200,255,0.35)"; c.fill(); c.strokeStyle = "rgba(160,220,255,0.65)"; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.arc(it.x, it.y, 2, 0, Math.PI*2); c.fillStyle = "rgba(200,240,255,0.6)"; c.fill();
        break;
      case "roundtable":
        c.beginPath(); c.arc(it.x, it.y, it.r, 0, Math.PI*2); c.fillStyle = "#2a3048"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.14)"; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.arc(it.x + 3, it.y - 2, 1.8, 0, Math.PI*2); c.fillStyle = "#8a5a3a"; c.fill();
        break;
      case "frontdesk":
        c.save(); c.lineCap = "round"; c.lineWidth = 11; c.strokeStyle = "#2a2640";
        c.beginPath(); c.arc(it.x, it.y - 10, 28, Math.PI*0.12, Math.PI*0.88); c.stroke();
        c.lineWidth = 1.2; c.strokeStyle = "rgba(0,255,242,0.6)"; c.shadowColor = "rgba(0,255,242,0.6)"; c.shadowBlur = 5;
        c.beginPath(); c.arc(it.x, it.y - 10, 33.5, Math.PI*0.12, Math.PI*0.88); c.stroke(); c.restore();
        c.fillStyle = "#070a14"; c.fillRect(it.x - 6, it.y + 12, 12, 2.5);
        break;
      case "sofa":
        rr(c, it.x, it.y, it.w, it.h, 4); c.fillStyle = "#2c2748"; c.fill(); c.strokeStyle = "rgba(124,155,255,0.35)"; c.lineWidth = 1; c.stroke();
        rr(c, it.x + it.w - 4, it.y, 4, it.h, 2); c.fillStyle = "#3a3360"; c.fill();
        c.strokeStyle = "rgba(0,0,0,0.35)"; line(c, it.x + 1, it.y + it.h/3, it.x + it.w - 4, it.y + it.h/3); line(c, it.x + 1, it.y + it.h*2/3, it.x + it.w - 4, it.y + it.h*2/3);
        break;
      case "ctable":
        rr(c, it.x, it.y, it.w, it.h, 2); c.fillStyle = "#231f33"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 1; c.stroke();
        c.fillStyle = "rgba(255,46,196,0.4)"; c.fillRect(it.x + 4, it.y + 5, 7, 5);
        break;
      case "logo":
        c.save(); c.font = "700 10px 'Orbitron', sans-serif"; c.textAlign = "right"; c.fillStyle = "#00fff2";
        c.shadowColor = "rgba(0,255,242,0.8)"; c.shadowBlur = 6; c.fillText(brand, it.x, it.y); c.restore();
        break;
      case "notice":
        rr(c, it.x - it.w/2, it.y, it.w, 5, 1); c.fillStyle = "#3a2f1f"; c.fill();
        ["#ff2ec4", "#00fff2", "#ffb000", "#7cff6b"].forEach((col, i) => { c.fillStyle = col; c.fillRect(it.x - it.w/2 + 5 + i*10, it.y + 1.5, 2, 2); });
        break;
      case "extinguisher":
        c.beginPath(); c.arc(it.x, it.y, 3.5, 0, Math.PI*2); c.fillStyle = "rgba(255,59,59,0.85)"; c.fill();
        break;
      case "mat":
        rr(c, it.x - 16, it.y - 4, 32, 8, 2); c.fillStyle = "rgba(0,255,242,0.08)"; c.fill(); c.strokeStyle = "rgba(0,255,242,0.35)"; c.lineWidth = 1; c.stroke();
        break;
    }
  }

  // ---------------- routing ----------------
  function roomAt(pt){
    for (const id of ROOM_IDS){
      const r = L.rooms[id];
      if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return id;
    }
    return null;
  }
  function interiorRoute(id, pt){
    const r = L.rooms[id], ln = L.lanes[id];
    if (!ln) return [];
    if (ln.type === "aisles"){
      let ax = ln.xs[0], best = Infinity;
      ln.xs.forEach(x => { const s = Math.abs(x - pt.x) + Math.abs(x - r.doorX)*0.3; if (s < best){ best = s; ax = x; } });
      return [{ x:ax, y:r.inner.y }, { x:ax, y:pt.y }];
    }
    if (ln.type === "lane") return [{ x:ln.x, y:r.inner.y }, { x:ln.x, y:pt.y }];
    if (ln.type === "reception"){
      if (Math.abs(pt.x - ln.deskX) < 2 && Math.abs(pt.y - ln.chairY) < 2) return [{ x:ln.deskX, y:ln.chairY - 26 }];
      if (pt.x > ln.sofaLaneX - 2) return [{ x:ln.sofaLaneX, y:r.inner.y }, { x:ln.sofaLaneX, y:pt.y }];
    }
    return [];
  }
  function buildPath(fromId, from, toId, dest){
    if (fromId && fromId === toId) return interiorRoute(fromId, from).reverse().concat(interiorRoute(toId, dest), [dest]);
    let p = [];
    if (fromId){
      const f = L.rooms[fromId];
      p = p.concat(interiorRoute(fromId, from).reverse());
      p.push({ x:f.inner.x, y:f.inner.y }, { x:f.outer.x, y:f.outer.y });
    }
    const t = L.rooms[toId];
    p.push({ x:t.outer.x, y:t.outer.y }, { x:t.inner.x, y:t.inner.y });
    return p.concat(interiorRoute(toId, dest), [dest]);
  }
  function randInRoom(id, pad){
    const r = L.rooms[id]; pad = pad || 24;
    return { x:r.x + pad + Math.random()*Math.max(1, r.w - pad*2), y:r.y + pad + Math.random()*Math.max(1, r.h - pad*2) };
  }
  function freeSeat(id){
    const n = (L.seats[id] || []).length;
    for (let i = 0; i < n; i++){
      let taken = false;
      bodies.forEach(b => { if (b.home === id && b.seatIdx === i) taken = true; });
      if (!taken) return i;
    }
    return -1;
  }
  function pickSpot(id, b, tag){
    const spots = L.spots[id];
    if (!spots.length) return null;
    let candidates = spots.map((s, i) => i);
    if (tag){ const tagged = candidates.filter(i => spots[i].tag === tag); if (tagged.length) candidates = tagged; }
    const free = candidates.filter(i => { const key = id + ":" + i; let taken = false; bodies.forEach(o => { if (o !== b && o.spotKey === key) taken = true; }); return !taken; });
    const idx = free.length ? pick(free) : pick(candidates);
    return Object.assign({ key:id + ":" + idx }, spots[idx]);
  }

  function route(b, go){
    let room = go.room || b.home, dest, face = b.facing, key = null, kind = go.kind || "spot";
    if (kind === "home"){
      room = b.home;
      if (b.seatIdx >= 0){ const s = L.seats[room][b.seatIdx]; dest = { x:s.x, y:s.y }; face = s.face; }
      else dest = randInRoom(room);
    } else if (kind === "visit"){
      const t = bodies.get(go.agentId);
      if (t && t.seatIdx >= 0){
        room = t.home;
        const s = L.seats[room][t.seatIdx];
        dest = { x:s.x + 15, y:s.y + 2 }; face = Math.PI;
      } else if (t){ room = roomAt(t) || t.home; dest = { x:t.x + 15, y:t.y }; face = Math.PI; }
      else { room = b.home; dest = randInRoom(room); }
    } else if (kind === "exit"){
      room = "RECEPTION"; dest = { x:L.entrance.x, y:L.entrance.y + 12 }; face = Math.PI/2;
    } else {
      const sp = pickSpot(room, b, go.tag);
      if (sp){ dest = { x:sp.x, y:sp.y }; face = sp.face; key = sp.key; }
      else dest = randInRoom(room);
    }
    b.dest = { room, kind, face, key };
    b.spotKey = key;
    b.atSeat = false;
    const here = roomAt(b);
    if (here === room && dist(b, dest) < 3){ b.path = []; arrive(b); return; }
    b.path = buildPath(here, { x:b.x, y:b.y }, room, dest);
    b.walking = true;
  }

  function arrive(b){
    b.walking = false;
    b.room = b.dest.room;
    b.facing = b.dest.face;
    b.atSeat = b.dest.kind === "home" && b.seatIdx >= 0;
    if (b.leaving){ bodies.delete(b.id); if (selectedId === b.id){ selectedId = null; onSelect(null); } }
  }

  // ---------------- public API ----------------
  function upsert(a){
    let b = bodies.get(a.id);
    const isNew = !b;
    if (!b){
      const home = a.home || "DESK_B";
      b = { id:a.id, name:a.name || a.id, color:a.color || rooms[home].tint, role:a.role || "", home,
            seatIdx:-1, x:0, y:0, room:home, path:[], dest:null, spotKey:null, walking:false, atSeat:false,
            state:"idle", task:"", facing:-Math.PI/2, trail:[], bubble:null, lastChatAt:-1e9, goKey:null, leaving:false,
            n: bodies.size };
      bodies.set(a.id, b);
      b.seatIdx = freeSeat(home);
      let start;
      if (a.spawn === "entrance"){ start = { x:L.entrance.x, y:L.entrance.y + 12 }; }
      else if (a.spawn && a.spawn.near && bodies.get(a.spawn.near)){ const p = bodies.get(a.spawn.near); start = { x:p.x + 10, y:p.y + 6 }; }
      else if (b.seatIdx >= 0){ start = L.seats[home][b.seatIdx]; b.atSeat = true; b.room = home; }
      else start = randInRoom(home);
      b.x = start.x; b.y = start.y;
      b.room = roomAt(b) || home;
    }
    ["name", "color", "role", "state", "task"].forEach(k => { if (a[k] != null) b[k] = a[k]; });
    const go = a.go || (isNew ? { kind:"home" } : null);
    if (go){
      const key = JSON.stringify(go);
      if (key !== b.goKey || a.force){ b.goKey = key; route(b, go); }
    }
    return snapshot(b);
  }

  function say(id, text, ms){
    const b = bodies.get(id);
    if (!b || !text) return;
    b.bubble = { text:truncate(text, 46), until:performance.now() + (ms || 3200), dur:(ms || 3200) };
  }

  function remove(id){
    const b = bodies.get(id);
    if (!b) return;
    b.leaving = true;
    b.goKey = "exit";
    route(b, { kind:"exit" });
  }

  function snapshot(b){
    return { id:b.id, name:b.name, role:b.role, color:b.color, home:b.home, room:b.walking ? null : b.room,
             heading:b.walking && b.dest ? b.dest.room : null, state:b.state, task:b.task,
             walking:b.walking, seat:b.seatIdx >= 0 ? b.seatIdx + 1 : null, leaving:b.leaving };
  }

  // ---------------- dynamic render ----------------
  function glow(x, y, r, color, a){
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexToRgba(color, a)); g.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r*2, r*2);
  }

  function drawDynamic(now){
    const occupied = {};
    let meeting = 0, kopi = false;
    bodies.forEach(b => {
      if (b.atSeat && b.state === "working") occupied[b.home + ":" + b.seatIdx] = true;
      if (!b.walking && b.room === "MEETING") meeting++;
      if (!b.walking && b.spotKey && b.room === "PANTRY" && /coffee|kopi/i.test(b.task)) kopi = true;
    });
    const q = [];
    L.desks.forEach(d => {
      const on = occupied[d.room + ":" + d.idx];
      monitorRects(d).forEach(m => {
        if (on){
          ctx.fillStyle = hexToRgba(d.color, 0.85 + Math.sin(now/90 + d.idx*3)*0.08); ctx.fillRect(m.x, m.y, m.w, m.h);
          ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(m.x + 1, m.y + 1, m.w*0.4, 1);
        } else { ctx.fillStyle = "rgba(255,176,0,0.55)"; ctx.fillRect(m.x + m.w - 2, m.y + 1, 1, 1); }
      });
      if (on) q.push([d.x, d.y - d.h/2 + 5, 24, d.color, 0.26]);
    });
    L.racks.forEach((rk, ri) => {
      for (let i = 0; i < 5; i++){
        ctx.fillStyle = Math.sin(now/260 + i*1.7 + ri*2.3) > 0 ? hexToRgba(rk.color, 0.95) : hexToRgba(rk.color, 0.18);
        ctx.fillRect(rk.x - 3, rk.y + 2.5 + i*5.2, 2.4, 2);
        ctx.fillStyle = Math.sin(now/170 + i + ri) > 0.3 ? "rgba(124,255,107,0.9)" : "rgba(124,255,107,0.15)";
        ctx.fillRect(rk.x + 1.5, rk.y + 2.5 + i*5.2, 1.6, 2);
      }
      q.push([rk.x, rk.y + 15, 20, rk.color, 0.22]);
    });
    const tv = L.dyn.tv;
    if (meeting > 0){
      const cols = ["#7c9bff", "#00fff2", "#ff2ec4"], col = cols[Math.floor(now/2500) % 3];
      ctx.fillStyle = hexToRgba(col, 0.85); ctx.fillRect(tv.x + 0.5, tv.y + 1, tv.w - 1, tv.h - 2);
      q.push([tv.x - 4, tv.y + tv.h/2, 34, col, 0.3]);
    }
    const k = L.dyn.kpi;
    for (let i = 0; i < 6; i++){
      const hgt = (0.35 + 0.55*Math.abs(Math.sin(now/1400 + i*0.9))) * (k.h - 8), bw = (k.w - 8)/6 - 1.5;
      ctx.fillStyle = "rgba(255,176,0,0.85)"; ctx.fillRect(k.x + 4 + i*(bw + 1.5), k.y + k.h - 4 - hgt, bw, hgt);
    }
    q.push([k.x + k.w/2, k.y + k.h/2, 30, "#ffb000", 0.22]);
    const cf = L.dyn.coffee;
    ctx.fillStyle = kopi ? (Math.floor(now/180) % 2 ? "#ffb000" : "rgba(255,176,0,0.3)") : "rgba(124,255,107,0.8)";
    ctx.fillRect(cf.x + 2, cf.y - 4, 2, 2);
    const vm = L.dyn.vending, pulse = 0.35 + 0.25*Math.sin(now/600);
    ctx.strokeStyle = `rgba(255,46,196,${0.4 + pulse})`; ctx.lineWidth = 1.2; rr(ctx, vm.x, vm.y, vm.w, vm.h, 2); ctx.stroke();
    q.push([vm.x + vm.w/2, vm.y + vm.h/2, 26, "#ff2ec4", 0.18 + pulse*0.2]);
    const mt = L.dyn.mat;
    ctx.fillStyle = `rgba(0,255,242,${0.06 + 0.06*Math.sin(now/700)})`; ctx.fillRect(mt.x - 16, mt.y - 4, 32, 8);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const boost = 0.25 + 0.75*nightAmt;
    q.forEach(g => glow(g[0], g[1], g[2], g[3], g[4]*boost));
    ctx.restore();
  }

  function currentHour(){
    if (hourOverride != null) return hourOverride;
    const d = new Date();
    return d.getHours() + d.getMinutes()/60;
  }
  function nightFactor(h){
    if (h >= 8 && h < 17) return 0;
    if (h >= 17 && h < 20) return (h - 17)/3;
    if (h >= 5 && h < 8) return 1 - (h - 5)/3;
    return 1;
  }
  function drawLighting(h){
    if (nightAmt > 0){ ctx.fillStyle = `rgba(4,6,28,${0.58*nightAmt})`; ctx.fillRect(0, 0, W, H); }
    const dusk = Math.max(0, 1 - Math.abs(h - 18.5)/1.5), dawn = Math.max(0, 1 - Math.abs(h - 6.5)/1.5);
    if (dusk > 0){ ctx.fillStyle = `rgba(255,46,196,${0.10*dusk})`; ctx.fillRect(0, 0, W, H); }
    if (dawn > 0){ ctx.fillStyle = `rgba(255,176,0,${0.08*dawn})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawSprite(b, now){
    const walking = b.walking;
    const bob = walking ? Math.sin(now/90 + b.n) * 1.6 : 0;
    const leg = Math.sin(now/140 + b.n*2);
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.beginPath(); ctx.ellipse(0, 10, 7, 2.6, 0, 0, Math.PI*2); ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fill();
    const gr = ctx.createRadialGradient(0, -3, 0, 0, -3, 18);
    gr.addColorStop(0, hexToRgba(b.color, 0.30)); gr.addColorStop(1, hexToRgba(b.color, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, -3, 18, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = hexToRgba(b.color, 0.75);
    if (walking){ ctx.fillRect(-4, 6 + leg*1.6, 2.6, 5.5); ctx.fillRect(1.4, 6 - leg*1.6, 2.6, 5.5); }
    else { ctx.fillRect(-3.4, 7, 2.6, 4.5); ctx.fillRect(0.8, 7, 2.6, 4.5); }
    ctx.beginPath(); ctx.moveTo(-3.2, -6 + bob); ctx.lineTo(3.2, -6 + bob); ctx.lineTo(6.2, 8 + bob); ctx.lineTo(-6.2, 8 + bob); ctx.closePath();
    const tg = ctx.createLinearGradient(0, -6, 0, 8);
    tg.addColorStop(0, hexToRgba(b.color, 0.95)); tg.addColorStop(1, hexToRgba(b.color, 0.5));
    ctx.fillStyle = tg; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.stroke();
    ctx.beginPath(); ctx.fillStyle = "#0a0e1a"; ctx.arc(0, -10 + bob, 4.4, 0, Math.PI*2); ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = hexToRgba(b.color, 0.95); ctx.stroke();
    ctx.save(); ctx.translate(0, -10 + bob); ctx.rotate(b.facing == null ? Math.PI/2 : b.facing);
    ctx.strokeStyle = "#eafffc"; ctx.lineWidth = 1.4; ctx.shadowColor = "#eafffc"; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.moveTo(2.2, -2.4); ctx.lineTo(2.2, 2.4); ctx.stroke(); ctx.restore();
    if (b.state === "working"){
      ctx.beginPath(); ctx.strokeStyle = hexToRgba(b.color, 0.8); ctx.lineWidth = 1.1;
      ctx.arc(0, -10 + bob, 8 + Math.sin(now/220 + b.n)*1.2, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();

    if (b.state === "sleeping" && !walking){
      const t = (now/900 + b.n) % 1;
      ctx.save(); ctx.font = "9px 'Share Tech Mono', monospace";
      ctx.fillStyle = `rgba(215,251,246,${1 - t})`; ctx.fillText("z", b.x + 6 + t*4, b.y - 16 - t*10);
      ctx.fillStyle = `rgba(215,251,246,${0.6*(1 - t)})`; ctx.fillText("z", b.x + 10 + t*4, b.y - 24 - t*10);
      ctx.restore();
    }
    if (b.state === "waiting"){
      const p = 0.6 + 0.4*Math.sin(now/180);
      ctx.save(); ctx.font = "700 12px 'Orbitron', sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = `rgba(255,176,0,${p})`; ctx.shadowColor = "#ffb000"; ctx.shadowBlur = 8;
      ctx.fillText("!", b.x + 11, b.y - 12); ctx.restore();
    }
    if (b.state === "thinking" && !walking){
      ctx.save(); ctx.fillStyle = "rgba(215,251,246,0.85)";
      for (let i = 0; i < 3; i++){
        const on = Math.floor(now/300) % 3 >= i;
        ctx.globalAlpha = on ? 0.9 : 0.25;
        ctx.beginPath(); ctx.arc(b.x - 5 + i*5, b.y - 30, 1.6, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBubble(b, now){
    const remaining = b.bubble.until - now, elapsed = b.bubble.dur - remaining;
    let alpha = 1;
    if (remaining < 300) alpha = Math.max(0, remaining/300);
    if (elapsed < 150) alpha = Math.min(alpha, elapsed/150);
    ctx.font = "9px 'Share Tech Mono', monospace";
    const text = b.bubble.text, bw = ctx.measureText(text).width + 12, bh = 17;
    const bx = b.x - bw/2, by = b.y - 34 - bh;
    ctx.save(); ctx.globalAlpha = alpha;
    rr(ctx, bx, by, bw, bh, 4); ctx.fillStyle = "rgba(10,14,26,0.92)"; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = hexToRgba(b.color, 0.85); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x - 4, by + bh - 1); ctx.lineTo(b.x + 4, by + bh - 1); ctx.lineTo(b.x, by + bh + 6); ctx.closePath();
    ctx.fillStyle = "rgba(10,14,26,0.92)"; ctx.fill(); ctx.strokeStyle = hexToRgba(b.color, 0.85); ctx.stroke();
    ctx.fillStyle = "#eafffc"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, b.x, by + bh/2);
    ctx.restore();
  }

  function drawReticle(b, now){
    const cx = b.x, cy = b.y - 3, r = 15*(1 + Math.sin(now/220)*0.08), len = 5;
    ctx.save(); ctx.strokeStyle = "#eafffc"; ctx.lineWidth = 1.3; ctx.shadowColor = "#00fff2"; ctx.shadowBlur = 6;
    [[-r,-r,1,1], [r,-r,-1,1], [-r,r,1,-1], [r,r,-1,-1]].forEach(c => {
      ctx.beginPath(); ctx.moveTo(cx + c[0], cy + c[1]); ctx.lineTo(cx + c[0] + c[2]*len, cy + c[1]);
      ctx.moveTo(cx + c[0], cy + c[1]); ctx.lineTo(cx + c[0], cy + c[1] + c[3]*len); ctx.stroke();
    });
    ctx.restore();
  }

  // ---------------- loop ----------------
  function frame(now){
    const dt = Math.min(0.05, (now - last)/1000);
    last = now;
    const h = currentHour();
    nightAmt = nightFactor(h);

    bodies.forEach(b => {
      if (b.walking){
        const t = b.path[0];
        if (!t){ arrive(b); return; }
        const dx = t.x - b.x, dy = t.y - b.y, d = Math.hypot(dx, dy), step = 38*dt;
        if (d <= step){ b.x = t.x; b.y = t.y; b.path.shift(); if (!b.path.length) arrive(b); }
        else { b.x += dx/d*step; b.y += dy/d*step; b.facing = Math.atan2(dy, dx); }
      }
      b.trail.push({ x:b.x, y:b.y });
      if (b.trail.length > 12) b.trail.shift();
    });

    if (chatter){
      const list = Array.from(bodies.values());
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++){
        const A = list[i], B = list[j];
        if (now - A.lastChatAt < 7000 || now - B.lastChatAt < 7000) continue;
        if (!A.walking && !B.walking) continue;
        if ((A.x - B.x)**2 + (A.y - B.y)**2 < 400){
          const t = pick(chatter);
          A.lastChatAt = B.lastChatAt = now;
          say(A.id, t, 2000); say(B.id, t, 2000);
          if (opts.onChatter) opts.onChatter(A.id, B.id);
        }
      }
    }

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);
    drawLighting(h);
    drawDynamic(now);
    const order = Array.from(bodies.values()).sort((p, q) => p.y - q.y);
    order.forEach(b => {
      for (let t = 0; t < b.trail.length; t++){
        const p = b.trail[t];
        ctx.beginPath(); ctx.fillStyle = hexToRgba(b.color, (t/b.trail.length)*0.16); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
      }
      drawSprite(b, now);
    });
    order.forEach(b => {
      ctx.font = "9px 'Orbitron', sans-serif"; ctx.fillStyle = "rgba(215,251,246,0.85)"; ctx.textAlign = "center";
      ctx.fillText(b.name, b.x, b.y - 22); ctx.textAlign = "left";
      if (b.bubble && now < b.bubble.until) drawBubble(b, now);
      if (b.id === selectedId) drawReticle(b, now);
    });
    requestAnimationFrame(frame);
  }

  // ---------------- input & resize ----------------
  function findNear(px, py){
    let best = null, bd = 18;
    bodies.forEach(b => { const d = Math.hypot(b.x - px, b.y - 3 - py); if (d <= bd){ best = b; bd = d; } });
    return best;
  }
  canvas.addEventListener("click", e => {
    const r = canvas.getBoundingClientRect();
    const b = findNear(e.clientX - r.left, e.clientY - r.top);
    if (b){ selectedId = b.id; onSelect(snapshot(b)); }
  });
  canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect();
    canvas.style.cursor = findNear(e.clientX - r.left, e.clientY - r.top) ? "pointer" : "default";
  });

  function resize(){
    const rect = canvas.parentElement.getBoundingClientRect();
    const oldW = W, oldH = H;
    W = Math.max(1, rect.width); H = Math.max(1, rect.height);
    canvas.width = Math.floor(W*DPR); canvas.height = Math.floor(H*DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildLayout();
    if (oldW > 1 && oldH > 1){
      const sx = W/oldW, sy = H/oldH;
      bodies.forEach(b => {
        b.x *= sx; b.y *= sy; b.trail = [];
        b.path.forEach(p => { p.x *= sx; p.y *= sy; });
        if (b.atSeat && !b.walking){ const s = L.seats[b.home][b.seatIdx]; b.x = s.x; b.y = s.y; }
      });
    }
  }
  window.addEventListener("resize", resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (L) renderStatic(); });
  resize();
  requestAnimationFrame(frame);

  return {
    upsert, say, remove,
    get: id => { const b = bodies.get(id); return b ? snapshot(b) : null; },
    list: () => Array.from(bodies.values()).map(snapshot),
    has: id => bodies.has(id),
    select: id => { selectedId = bodies.has(id) ? id : null; onSelect(selectedId ? snapshot(bodies.get(selectedId)) : null); },
    get selectedId(){ return selectedId; },
    setHour: h => { hourOverride = h == null ? null : ((h % 24) + 24) % 24; },
    roomLabel: id => (rooms[id] || {}).label || id
  };
}

// ------------------------------------------------------------
// HUD helpers shared by the three apps
// ------------------------------------------------------------
export function createHud({ office, rosterEl, logEl, detailEl, onSelectChange }){
  function log(html){
    const el = document.createElement("div");
    el.className = "log-line";
    el.innerHTML = html;
    logEl.insertBefore(el, logEl.firstChild);
    while (logEl.children.length > 80) logEl.removeChild(logEl.lastChild);
  }
  function where(a){
    if (a.leaving) return "leaving";
    if (a.walking) return "→ " + office.roomLabel(a.heading).toLowerCase();
    return office.roomLabel(a.room).toLowerCase();
  }
  function refresh(){
    const sel = office.selectedId;
    rosterEl.innerHTML = office.list().map(a =>
      `<div class="agent-row${a.id === sel ? " selected" : ""}" data-id="${escapeHtml(a.id)}">` +
      `<span class="dot" style="color:${a.color}"></span>` +
      `<span class="agent-name">${escapeHtml(a.name)}</span>` +
      `<span class="agent-role">${escapeHtml(a.role)}</span>` +
      `<span class="agent-task">${escapeHtml(a.walking ? where(a) : a.task)}</span></div>`).join("") ||
      `<div class="empty">No agents yet.</div>`;
    if (detailEl){
      const a = sel ? office.get(sel) : null;
      detailEl.innerHTML = a
        ? `<b>${escapeHtml(a.name)}</b> &middot; ${escapeHtml(a.role)}${a.seat ? " &middot; desk #" + a.seat : ""}<br>` +
          `Location: ${escapeHtml(where(a))} &middot; ${escapeHtml(a.state)}<br>` +
          `Task: <span class="si-task">${escapeHtml(a.task || "—")}</span>`
        : "Click an agent, or a roster row, to inspect.";
    }
  }
  rosterEl.addEventListener("click", e => {
    const row = e.target.closest(".agent-row");
    if (!row) return;
    office.select(row.dataset.id);
    refresh();
    if (onSelectChange) onSelectChange(row.dataset.id);
  });
  setInterval(refresh, 600);
  return { log, refresh };
}

// Connects to the app server's SSE stream and applies office events.
export function connectEvents({ office, hud, onEvent, onStatus }){
  let es;
  function open(){
    es = new EventSource("/events");
    es.onopen = () => onStatus && onStatus(true);
    es.onerror = () => { onStatus && onStatus(false); };
    es.onmessage = m => {
      let evt;
      try { evt = JSON.parse(m.data); } catch(e){ return; }
      apply(evt);
    };
  }
  function apply(evt){
    if (evt.type === "batch"){ evt.events.forEach(apply); return; }
    if (evt.type === "upsert") office.upsert(evt.agent);
    else if (evt.type === "say") office.say(evt.id, evt.text, evt.ms);
    else if (evt.type === "remove") office.remove(evt.id);
    else if (evt.type === "log") hud.log(evt.html);
    else if (evt.type === "hour") office.setHour(evt.hour);
    if (onEvent) onEvent(evt);
  }
  open();
  return { close: () => es && es.close() };
}
