/* EXO · Control de producción
   Usuarios: Firebase Authentication. Datos y fotos: Cloud Firestore (plan gratuito Spark).
   Configuración en config.js. */
(function(){
"use strict";

const cfg = window.EXO_FIREBASE || {};
const ESTADOS = [["pendiente","Pendiente"],["produccion","En producción"],["terminado","Terminado"],["anulado","Anulado"]];
const ESTADO_TXT = Object.fromEntries(ESTADOS);
const PAGINA = 150;   // pedidos que se mantienen sincronizados en vivo
const S = { db:null, auth:null, user:null, arts:[], peds:[], items:[], edit:null,
  hisFiltro:"todos", hisLimite:40, limServ:PAGINA, hayMas:false, catSel:null, artEdit:null,
  unsubArts:null, unsubPeds:null };

/* ---------- Utilidades ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const fmtFecha = iso => { const d = new Date(iso); return (!iso || isNaN(d)) ? "" :
  d.toLocaleString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); };
const ahoraISO = () => new Date().toISOString();
const skuId = s => "s-" + String(s).trim().replace(/[^A-Za-z0-9_\-~:@+]/g, "_");
const nroKey = s => "n-" + encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, " "));
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k,v){ try { localStorage.setItem(k,v); } catch(e){} }

let toastT;
function toast(msg, bad){
  const t = $("toast"); t.textContent = msg; t.className = "toast on" + (bad ? " bad" : "");
  clearTimeout(toastT); toastT = setTimeout(() => t.className = "toast", 2800);
}
function confirmar(titulo, texto, boton){
  return new Promise(res => {
    const d = $("dlgConfirm"); $("cfTitle").textContent = titulo; $("cfText").textContent = texto;
    $("cfYes").textContent = boton || "Eliminar";
    const fin = v => { d.close(); $("cfYes").onclick = $("cfNo").onclick = null; res(v); };
    $("cfYes").onclick = () => fin(true); $("cfNo").onclick = () => fin(false); d.oncancel = () => fin(false);
    d.showModal();
  });
}
function errMsg(e){
  const c = e && e.code;
  if (c === "dup") return "Ya existe un pedido con ese número.";
  if (c === "permission-denied") return "Tu usuario no está habilitado. Pedile al administrador que lo agregue a la lista de permitidos.";
  if (c === "unavailable" || c === "deadline-exceeded") return "Sin conexión. Revisá internet e intentá de nuevo.";
  if (c === "resource-exhausted") return "Se alcanzó el límite gratuito diario de Firebase. Vuelve a funcionar mañana.";
  if (c === "invalid-argument" && /size|bytes/i.test(e.message || "")) return "La foto es demasiado grande.";
  return "No se pudo guardar. " + (e && e.message ? e.message : "Intentá de nuevo.");
}

/* ---------- Pestañas ---------- */
const TABS = ["orden","historial","catalogo"];
function irA(tab, push){
  if (!TABS.includes(tab)) tab = "orden";
  TABS.forEach(t => $("v-"+t).classList.toggle("active", t === tab));
  document.querySelectorAll("[data-tab]").forEach(b => { if (b.dataset.tab === tab) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
  if (push !== false) { try { history.replaceState(null, "", "#" + tab); } catch(e){} }
  window.scrollTo(0,0);
}
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => irA(b.dataset.tab)));
window.addEventListener("hashchange", () => irA(location.hash.slice(1), false));

/* ---------- Datos en vivo ---------- */
function onErrSnap(e){
  if (e && e.code === "permission-denied") { estado(false, "Sin permiso"); toast(errMsg(e), true); }
  else estado(false, "Reconectando…");
}
function suscribirArts(){
  if (S.unsubArts) S.unsubArts();
  S.unsubArts = S.db.collection("articulos").onSnapshot(snap => {
    S.arts = snap.docs.map(d => d.data()).filter(a => a && a.sku)
      .sort((a,b) => (a.categoria||"").localeCompare(b.categoria||"") || (a.descripcion||"").localeCompare(b.descripcion||""));
    renderCatalogo(); if ($("qPieza").value) buscarPiezas();
    estado(!snap.metadata.fromCache, snap.metadata.fromCache ? "Sin conexión" : "En línea");
  }, onErrSnap);
}
function suscribirPeds(){
  if (S.unsubPeds) S.unsubPeds();
  S.unsubPeds = S.db.collection("pedidos").orderBy("fecha","desc").limit(S.limServ).onSnapshot(snap => {
    S.peds = snap.docs.map(d => ({...d.data(), id: d.id, items: d.data().items || [], fotos: d.data().fotos || [], estado: d.data().estado || "pendiente"}));
    S.hayMas = snap.size >= S.limServ;
    renderHistorial(); renderSugerencias();
    estado(!snap.metadata.fromCache, snap.metadata.fromCache ? "Sin conexión" : "En línea");
  }, onErrSnap);
}

/* ---------- Nueva orden ---------- */
function renderItems(){
  const ul = $("items");
  ul.innerHTML = S.items.map((it,i) => `
    <li>
      <span class="sku">#${esc(it.sku)}</span>
      <span class="desc">${esc(it.descripcion)}</span>
      <span class="qty">
        <button type="button" data-i="${i}" data-d="-1" aria-label="Restar uno">−</button>
        <input type="text" inputmode="numeric" value="${it.cantidad}" data-i="${i}" aria-label="Cantidad">
        <button type="button" data-i="${i}" data-d="1" aria-label="Sumar uno">+</button>
      </span>
      <button type="button" class="x" data-del="${i}" aria-label="Quitar pieza">×</button>
    </li>`).join("");
  ul.style.display = S.items.length ? "" : "none";
  $("itemsEmpty").style.display = S.items.length ? "none" : "";
  const tot = S.items.reduce((a,b) => a + b.cantidad, 0);
  $("itemsCount").textContent = S.items.length ? `${S.items.length} códigos, ${tot} unidades` : "";
}
$("items").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.del !== undefined) { S.items.splice(+b.dataset.del,1); renderItems(); return; }
  const it = S.items[+b.dataset.i]; if (!it) return;
  it.cantidad = Math.max(1, it.cantidad + (+b.dataset.d)); renderItems();
});
$("items").addEventListener("change", e => {
  const inp = e.target.closest("input"); if (!inp) return;
  const n = parseInt(inp.value,10); S.items[+inp.dataset.i].cantidad = n > 0 ? n : 1; renderItems();
});
function agregarPieza(a){
  const ex = S.items.find(x => x.sku === a.sku);
  if (ex) ex.cantidad++; else S.items.push({sku:a.sku, descripcion:a.descripcion, cantidad:1});
  renderItems(); toast(`Agregado #${a.sku}`);
}
let buscT;
function buscarPiezas(){
  const q = norm($("qPieza").value), ul = $("resPieza");
  if (q.length < 2) { ul.innerHTML = ""; ul._res = []; $("hintPieza").textContent = "Escribí al menos 2 letras o números."; return []; }
  const palabras = q.split(/\s+/);
  const res = S.arts.filter(a => { const t = norm(a.sku + " " + a.descripcion + " " + a.categoria); return palabras.every(p => t.includes(p)); }).slice(0,15);
  ul.innerHTML = res.map((a,i) => `<li><button type="button" data-k="${i}"><span class="sku">#${esc(a.sku)}</span><span class="desc">${esc(a.descripcion)}</span><span class="plus">+</span></button></li>`).join("");
  $("hintPieza").textContent = res.length ? "Tocá una pieza para agregarla. Enter agrega la primera." : "No hay piezas con ese texto.";
  ul._res = res; return res;
}
$("qPieza").addEventListener("input", () => { clearTimeout(buscT); buscT = setTimeout(buscarPiezas, 150); });
$("qPieza").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const r = buscarPiezas(); if (r[0]) agregarPieza(r[0]); } });
$("resPieza").addEventListener("click", e => { const b = e.target.closest("button"); if (b) agregarPieza($("resPieza")._res[+b.dataset.k]); });

function limpiarForm(){
  ["fNro","fCli","fObs"].forEach(id => { $(id).value = ""; $(id).classList.remove("err"); });
  $("fVen").value = lsGet("exo-vendedor") || ""; $("fResp").value = lsGet("exo-responsable") || "";
  S.items = []; S.edit = null; renderItems();
  $("editBanner").classList.remove("on"); $("ordenTitle").textContent = "Nueva orden"; $("btnGuardar").textContent = "Guardar pedido";
}
$("cancelEdit").addEventListener("click", () => { limpiarForm(); irA("historial"); });
function cargarEnForm(p){
  S.edit = p;
  $("fNro").value = p.nro || ""; $("fCli").value = p.cliente || ""; $("fVen").value = p.vendedor || "";
  $("fResp").value = p.responsable || ""; $("fObs").value = p.observaciones || "";
  S.items = (p.items || []).map(x => ({...x})); renderItems();
  $("editTxt").textContent = `Editando pedido ${p.nro}`; $("editBanner").classList.add("on");
  $("ordenTitle").textContent = "Editar orden"; $("btnGuardar").textContent = "Guardar cambios";
  irA("orden");
}
$("btnGuardar").addEventListener("click", async () => {
  const nro = $("fNro").value.trim(), cli = $("fCli").value.trim();
  $("fNro").classList.toggle("err", !nro); $("fCli").classList.toggle("err", !cli);
  if (!nro || !cli) { toast("Completá número de pedido y cliente.", true); (nro ? $("fCli") : $("fNro")).focus(); return; }
  if (!S.items.length) { toast("Agregá al menos una pieza.", true); $("qPieza").focus(); return; }
  const dup = S.peds.find(p => norm(p.nro) === norm(nro) && (!S.edit || p.id !== S.edit.id));
  if (dup) { $("fNro").classList.add("err"); toast(`El pedido ${nro} ya existe (cliente ${dup.cliente}).`, true); return; }
  const ahora = ahoraISO();
  const fila = { nro, cliente: cli, vendedor: $("fVen").value.trim(), responsable: $("fResp").value.trim(),
    observaciones: $("fObs").value.trim(), items: S.items.map(x => ({sku:x.sku, descripcion:x.descripcion, cantidad:x.cantidad})),
    actualizado: ahora };
  const btn = $("btnGuardar"); btn.disabled = true;
  const db = S.db, nros = db.collection("nros"), peds = db.collection("pedidos");
  try {
    if (S.edit) {
      const id = S.edit.id, kOld = nroKey(S.edit.nro), kNew = nroKey(nro);
      await db.runTransaction(async tx => {
        if (kOld !== kNew) {
          const s = await tx.get(nros.doc(kNew));
          if (s.exists && s.data().pedido !== id) throw {code: "dup"};
          tx.delete(nros.doc(kOld)); tx.set(nros.doc(kNew), {pedido: id});
        }
        tx.update(peds.doc(id), fila);
      });
      toast("Cambios guardados"); limpiarForm(); irA("historial");
    } else {
      const ref = peds.doc();
      await db.runTransaction(async tx => {
        const s = await tx.get(nros.doc(nroKey(nro)));
        if (s.exists) throw {code: "dup"};
        tx.set(nros.doc(nroKey(nro)), {pedido: ref.id});
        tx.set(ref, {...fila, fecha: ahora, estado: "pendiente", fotos: []});
      });
      lsSet("exo-vendedor", fila.vendedor); lsSet("exo-responsable", fila.responsable);
      toast(`Pedido ${nro} guardado`); limpiarForm();
    }
  } catch(e) {
    if (e && e.code === "dup") { $("fNro").classList.add("err"); toast(`El pedido ${nro} ya existe.`, true); }
    else toast(errMsg(e), true);
  } finally { btn.disabled = false; }
});

/* ---------- Historial ---------- */
$("chipsEstado").innerHTML = [["todos","Todos"], ...ESTADOS].map(([k,v]) =>
  `<button class="chip" data-e="${k}" aria-pressed="${k==="todos"}">${v}</button>`).join("");
$("chipsEstado").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b) return;
  S.hisFiltro = b.dataset.e; S.hisLimite = 40;
  $("chipsEstado").querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", c === b));
  renderHistorial();
});
let hisT;
$("qHis").addEventListener("input", () => { clearTimeout(hisT); hisT = setTimeout(() => { S.hisLimite = 40; renderHistorial(); }, 200); });
$("btnMas").addEventListener("click", () => {
  if (pedidosFiltrados().length > S.hisLimite) { S.hisLimite += 40; renderHistorial(); }
  else if (S.hayMas) { S.limServ += PAGINA; S.hisLimite += 40; toast("Cargando pedidos anteriores…"); suscribirPeds(); }
});

const tieneHoja = p => (p.fotos || []).some(f => f.tipo === "hoja");
function pedidosFiltrados(){
  const q = norm($("qHis").value);
  return S.peds.filter(p => {
    if (S.hisFiltro !== "todos" && p.estado !== S.hisFiltro) return false;
    if (!q) return true;
    const t = norm([p.nro,p.cliente,p.vendedor,p.responsable,p.observaciones,...(p.items||[]).map(i => i.sku+" "+i.descripcion)].join(" "));
    return q.split(/\s+/).every(w => t.includes(w));
  });
}
function renderHistorial(){
  const abiertos = new Set([...document.querySelectorAll("details.ord[open]")].map(d => d.dataset.id));
  const lista = pedidosFiltrados(), vis = lista.slice(0, S.hisLimite);
  $("hisCount").textContent = S.peds.length ? `${lista.length} de ${S.peds.length}${S.hayMas ? "+" : ""} pedidos` : "";
  $("btnMas").hidden = !(lista.length > S.hisLimite || S.hayMas);
  if (!vis.length) {
    $("orders").innerHTML = `<div class="empty">${S.peds.length ? "Ningún pedido coincide con la búsqueda." : "Todavía no hay pedidos. Cargá el primero en Nueva orden."}</div>`;
    return;
  }
  $("orders").innerHTML = vis.map(p => {
    const est = p.estado, items = p.items || [], fotos = p.fotos || [];
    const tot = items.reduce((a,b) => a + (b.cantidad||0), 0);
    const tabla = items.length ? `<div style="overflow-x:auto"><table class="pz"><thead><tr><th>Código</th><th>Descripción</th><th style="text-align:right">Cant.</th></tr></thead><tbody>${
      items.map(i => `<tr><td class="sku">#${esc(i.sku)}</td><td>${esc(i.descripcion)}</td><td class="n">${i.cantidad}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="o-meta">Sin piezas cargadas.</div>`;
    return `<details class="ord" data-id="${esc(p.id)}" data-estado="${est}" ${abiertos.has(p.id) ? "open" : ""}>
      <summary>
        <span class="o-nro">Pedido ${esc(p.nro || "sin número")}</span>
        <span class="badge ${est}">${est === "terminado" ? (tieneHoja(p) ? "OK ✓" : "OK sin foto") : (ESTADO_TXT[est] || est)}</span>
        <span><span class="o-cli">${esc(p.cliente || "Sin cliente")}</span> <span class="o-meta">· ${fmtFecha(p.fecha)}${items.length ? ` · ${tot} u.` : ""}${fotos.length ? ` · 📷 ${fotos.length}` : ""}</span></span>
      </summary>
      <div class="o-body">
        <div class="o-grid">
          <div><b>Vendedor</b>${esc(p.vendedor || "—")}</div>
          <div><b>Responsable de línea</b>${esc(p.responsable || "—")}</div>
          <div><b>Cargado</b>${fmtFecha(p.fecha)}</div>
          ${p.actualizado && p.actualizado !== p.fecha ? `<div><b>Última modificación</b>${fmtFecha(p.actualizado)}</div>` : ""}
        </div>
        ${tabla}
        ${p.observaciones ? `<div class="o-grid"><div><b>Observaciones</b>${esc(p.observaciones)}</div></div>` : ""}
        ${fotos.length ? `<div class="fotos">${fotos.map((f,i) => `<button type="button" data-act="ver" data-f="${i}" aria-label="Ver foto"><img src="${esc(f.mini || "")}" alt="${f.tipo === "hoja" ? "Hoja del pedido" : "Foto del pedido"}"><span class="tag ${f.tipo === "hoja" ? "hoja" : ""}">${f.tipo === "hoja" ? "Hoja" : "Foto"}</span></button>`).join("")}</div>` : ""}
        ${p.terminadoEn ? `<div class="o-meta" style="margin-top:8px">Terminado el ${fmtFecha(p.terminadoEn)}</div>` : ""}
        <div class="o-actions">
          ${est !== "terminado" && est !== "anulado" ? `<button class="btn ok" data-act="ok">Marcar OK</button>` : ""}
          <select data-act="estado" aria-label="Estado del pedido">${ESTADOS.map(([k,v]) => `<option value="${k}" ${k===est?"selected":""}>${v}</option>`).join("")}</select>
          <button class="btn" data-act="editar">Editar</button>
          <button class="btn" data-act="copiar">Copiar texto</button>
          <button class="btn" data-act="foto">📷 Foto</button>
          <span class="spacer"></span>
          <button class="btn danger" data-act="borrar">Eliminar</button>
        </div>
      </div>
    </details>`;
  }).join("");
}

function pedidoDe(el){ const d = el.closest("details.ord"); return d && S.peds.find(p => p.id === d.dataset.id); }
function textoPedido(p){
  const l = [`PEDIDO ${p.nro}`, `Cliente: ${p.cliente}`];
  if (p.vendedor) l.push(`Vendedor: ${p.vendedor}`);
  if (p.responsable) l.push(`Responsable: ${p.responsable}`);
  l.push(`Fecha: ${fmtFecha(p.fecha)}`, `Estado: ${ESTADO_TXT[p.estado]}`, "");
  (p.items||[]).forEach(i => l.push(`${i.cantidad} x #${i.sku} ${i.descripcion}`));
  if (p.observaciones) l.push("", `Obs.: ${p.observaciones}`);
  return l.join("\n");
}
$("orders").addEventListener("click", async e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const p = pedidoDe(b); if (!p) return;
  const act = b.dataset.act;
  if (act === "editar") cargarEnForm(p);
  if (act === "ok") { if (tieneHoja(p)) cambiarEstado(p, "terminado"); else pedirHoja(p); }
  if (act === "foto") { fotoCtx = {pid: p.id, tipo: "foto"}; $("fotoIn").click(); }
  if (act === "ver") verFoto(p, +b.dataset.f);
  if (act === "copiar") {
    try { await navigator.clipboard.writeText(textoPedido(p)); toast("Pedido copiado. Ya podés pegarlo en WhatsApp o un mail."); }
    catch(err) { toast("Este navegador no permitió copiar.", true); }
  }
  if (act === "borrar") {
    if (!(await confirmar(`Eliminar pedido ${p.nro}`, "Se borra para todos, con sus fotos, y no se puede deshacer. Si solo querés sacarlo de la lista activa, cambiá su estado a Anulado."))) return;
    try {
      const batch = S.db.batch();
      batch.delete(S.db.collection("pedidos").doc(p.id));
      batch.delete(S.db.collection("nros").doc(nroKey(p.nro)));
      (p.fotos || []).forEach(f => f.id && batch.delete(S.db.collection("fotos").doc(f.id)));
      await batch.commit();
      toast("Pedido eliminado");
    } catch(err) { toast(errMsg(err), true); }
  }
});
$("orders").addEventListener("change", e => {
  const s = e.target.closest("select[data-act=estado]"); if (!s) return;
  const p = pedidoDe(s); if (!p) return;
  if (s.value === "terminado" && !tieneHoja(p)) { s.value = p.estado; pedirHoja(p); return; }
  cambiarEstado(p, s.value);
});
async function cambiarEstado(p, est){
  const ahora = ahoraISO(), upd = {estado: est, actualizado: ahora};
  if (est === "terminado") upd.terminadoEn = ahora;
  try { await S.db.collection("pedidos").doc(p.id).update(upd); toast(`Pedido ${p.nro}: ${est === "terminado" ? "OK" : ESTADO_TXT[est]}`); }
  catch(err) { toast(errMsg(err), true); renderHistorial(); }
}

/* ---------- Fotos (comprimidas y guardadas en Firestore) ---------- */
let fotoCtx = null, okPedido = null, verCtx = null;

function pedirHoja(p){
  okPedido = p;
  $("okTitle").textContent = `Cerrar pedido ${p.nro}`;
  $("okText").textContent = "Para marcarlo como OK, sacale una foto a la hoja del pedido.";
  $("okNote").textContent = "La foto queda guardada en el pedido y la ven todos.";
  $("okFoto").hidden = false; $("okSinFoto").hidden = true;
  $("dlgOk").classList.remove("busy"); $("dlgOk").showModal();
}
$("okCancel").addEventListener("click", () => { okPedido = null; $("dlgOk").close(); });
$("okFoto").addEventListener("click", () => { if (!okPedido) return; fotoCtx = {pid: okPedido.id, tipo: "hoja"}; $("fotoIn").click(); });

function leerDataURL(file){
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
async function cargarImagen(file){
  const src = await leerDataURL(file);
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej({message: "No se pudo leer la imagen. Probá con JPG o PNG."}); i.src = src; });
}
/* Achica la imagen hasta que entre en el tamaño máximo (Firestore admite hasta 1 MB por documento) */
function aJPEG(img, ladoMax, calidad, maxChars){
  let lado = ladoMax, q = calidad, url = "";
  for (let intento = 0; intento < 8; intento++) {
    const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    url = c.toDataURL("image/jpeg", q);
    if (!maxChars || url.length <= maxChars) return url;
    if (q > 0.45) q -= 0.1; else lado = Math.round(lado * 0.8);
  }
  return url;
}
$("fotoIn").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0]; e.target.value = "";
  const ctx = fotoCtx; fotoCtx = null;
  if (!file || !ctx) return;
  const esHoja = ctx.tipo === "hoja";
  if (esHoja) { $("dlgOk").classList.add("busy"); $("okNote").textContent = "Subiendo foto…"; } else toast("Subiendo foto…");
  try {
    const img = await cargarImagen(file);
    const grande = aJPEG(img, 1400, 0.72, 700000);
    const mini = aJPEG(img, 220, 0.6, 30000);
    const ahora = ahoraISO(), fref = S.db.collection("fotos").doc();
    const meta = {id: fref.id, tipo: ctx.tipo, fecha: ahora, mini};
    const upd = { fotos: firebase.firestore.FieldValue.arrayUnion(meta), actualizado: ahora };
    if (esHoja) { upd.estado = "terminado"; upd.terminadoEn = ahora; }
    const batch = S.db.batch();
    batch.set(fref, {pedido: ctx.pid, tipo: ctx.tipo, fecha: ahora, data: grande});
    batch.update(S.db.collection("pedidos").doc(ctx.pid), upd);
    await batch.commit();
    const p = S.peds.find(x => x.id === ctx.pid);
    if (esHoja) { $("dlgOk").close(); okPedido = null; toast(`Pedido ${p ? p.nro : ""} marcado OK ✓`); }
    else toast("Foto agregada");
  } catch(err) {
    const msg = err && err.message && !err.code ? err.message : errMsg(err);
    if (esHoja) { $("dlgOk").classList.remove("busy"); $("okNote").textContent = msg; } else toast(msg, true);
  }
});
async function verFoto(p, i){
  const f = (p.fotos || [])[i]; if (!f) return;
  verCtx = {pid: p.id, id: f.id};
  $("verImg").src = f.mini || "";
  $("verImg").alt = f.tipo === "hoja" ? "Hoja del pedido" : "Foto del pedido";
  $("verTxt").textContent = `${f.tipo === "hoja" ? "Hoja del pedido" : "Foto"} · pedido ${p.nro} · ${fmtFecha(f.fecha)}`;
  $("dlgVer").showModal();
  try {
    const d = await S.db.collection("fotos").doc(f.id).get();
    if (d.exists && verCtx && verCtx.id === f.id) $("verImg").src = d.data().data;
  } catch(e) { toast("No se pudo cargar la foto en tamaño completo.", true); }
}
$("verCerrar").addEventListener("click", () => $("dlgVer").close());
$("verQuitar").addEventListener("click", async () => {
  const ctx = verCtx; $("dlgVer").close(); if (!ctx) return;
  const p = S.peds.find(x => x.id === ctx.pid); if (!p) return;
  const f = (p.fotos || []).find(x => x.id === ctx.id);
  const aviso = f && f.tipo === "hoja" ? "Es la foto de la hoja: el pedido va a quedar como OK sin foto." : "La foto se borra para todos.";
  if (!(await confirmar("Quitar foto", aviso, "Quitar"))) return;
  try {
    const batch = S.db.batch();
    batch.update(S.db.collection("pedidos").doc(p.id), {fotos: (p.fotos || []).filter(x => x.id !== ctx.id), actualizado: ahoraISO()});
    batch.delete(S.db.collection("fotos").doc(ctx.id));
    await batch.commit();
    toast("Foto quitada");
  } catch(err) { toast(errMsg(err), true); }
});
document.addEventListener("error", e => { if (e.target && e.target.tagName === "IMG") e.target.classList.add("broken"); }, true);

/* ---------- Catálogo ---------- */
function renderCatalogo(){
  const cats = [...new Set(S.arts.map(a => a.categoria))].sort();
  if (S.catSel && !cats.includes(S.catSel)) S.catSel = null;
  $("chipsCat").innerHTML = [`<button class="chip" data-c="" aria-pressed="${!S.catSel}">Todas</button>`,
    ...cats.map(c => `<button class="chip" data-c="${esc(c)}" aria-pressed="${c===S.catSel}">${esc(c)}</button>`)].join("");
  $("dlCat").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
  const q = norm($("qCat").value);
  const lista = S.arts.filter(a => (!S.catSel || a.categoria === S.catSel) &&
    (!q || q.split(/\s+/).every(w => norm(a.sku+" "+a.descripcion+" "+a.categoria).includes(w))));
  $("catCount").textContent = S.arts.length ? `${lista.length} de ${S.arts.length} artículos` : "";
  $("catList").innerHTML = lista.length ? lista.map(a => `<li><button data-s="${esc(a.sku)}"><span class="sku">#${esc(a.sku)}</span><span class="desc">${esc(a.descripcion)}</span><span class="c">${esc(a.categoria)}</span></button></li>`).join("")
    : `<li class="empty" style="border:0">${S.arts.length ? "No hay artículos con ese filtro." : "El catálogo está vacío. Tocá Importar TXT y elegí catalogo_inicial.txt."}</li>`;
}
$("chipsCat").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; S.catSel = b.dataset.c || null; renderCatalogo(); });
let catT; $("qCat").addEventListener("input", () => { clearTimeout(catT); catT = setTimeout(renderCatalogo, 150); });

function abrirArt(a){
  S.artEdit = a || null;
  $("artTitle").textContent = a ? `Editar #${a.sku}` : "Agregar artículo";
  $("aCat").value = a ? a.categoria : (S.catSel || ""); $("aSku").value = a ? a.sku : ""; $("aDesc").value = a ? a.descripcion : "";
  ["aCat","aSku","aDesc"].forEach(id => $(id).classList.remove("err"));
  $("artDel").hidden = !a; $("dlgArt").showModal();
}
$("btnNuevoArt").addEventListener("click", () => abrirArt(null));
$("catList").addEventListener("click", e => { const b = e.target.closest("button[data-s]"); if (b) abrirArt(S.arts.find(a => a.sku === b.dataset.s)); });
$("artCancel").addEventListener("click", () => $("dlgArt").close());
$("artSave").addEventListener("click", async () => {
  const cat = $("aCat").value.trim().toUpperCase(), sku = $("aSku").value.trim().replace(/^#/, ""), desc = $("aDesc").value.trim();
  $("aCat").classList.toggle("err", !cat); $("aSku").classList.toggle("err", !sku); $("aDesc").classList.toggle("err", !desc);
  if (!cat || !sku || !desc) { toast("Completá categoría, código y descripción.", true); return; }
  const otro = S.arts.find(a => a.sku === sku);
  if (otro && (!S.artEdit || S.artEdit.sku !== sku)) { $("aSku").classList.add("err"); toast(`El código #${sku} ya existe: ${otro.descripcion}`, true); return; }
  try {
    const batch = S.db.batch();
    batch.set(S.db.collection("articulos").doc(skuId(sku)), {sku, categoria: cat, descripcion: desc});
    if (S.artEdit && S.artEdit.sku !== sku) batch.delete(S.db.collection("articulos").doc(skuId(S.artEdit.sku)));
    await batch.commit();
    $("dlgArt").close(); toast(S.artEdit ? "Artículo actualizado" : "Artículo agregado");
  } catch(err) { toast(errMsg(err), true); }
});
$("artDel").addEventListener("click", async () => {
  const a = S.artEdit; if (!a) return;
  $("dlgArt").close();
  if (!(await confirmar(`Eliminar #${a.sku}`, `${a.descripcion}. Los pedidos ya cargados con esta pieza no cambian.`))) return;
  try { await S.db.collection("articulos").doc(skuId(a.sku)).delete(); toast("Artículo eliminado"); }
  catch(err) { toast(errMsg(err), true); }
});

/* ---------- Importar TXT ---------- */
async function leerTexto(file){
  const buf = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", {fatal: true}).decode(buf); }
  catch(e) { return new TextDecoder("windows-1252").decode(buf); }
}
function dialogoImport(titulo, texto, problemas, nota, conBoton){
  return new Promise(res => {
    const d = $("dlgImp");
    $("impTitle").textContent = titulo; $("impText").textContent = texto;
    $("impProbs").hidden = !problemas.length; $("impProbs").textContent = problemas.join("\n");
    $("impNote").textContent = nota || "";
    $("impYes").hidden = !conBoton; $("impNo").textContent = conBoton ? "Cancelar" : "Cerrar";
    const fin = v => { d.close(); $("impYes").onclick = $("impNo").onclick = null; res(v); };
    $("impYes").onclick = () => fin(true); $("impNo").onclick = () => fin(false); d.oncancel = () => fin(false);
    d.showModal();
  });
}
/* Pedido desde TXT: "Pedido 123", "Cliente: X", "Vendedor: X", "Responsable: X", "Obs.: X"
   y piezas como "1035", "#1035 x2", "2 x #1035", "1035;2" */
function parsePedidoTxt(txt){
  const out = {campos: {}, items: [], problemas: []};
  const porSku = new Map(S.arts.map(a => [a.sku.toLowerCase(), a]));
  txt.split(/\r?\n/).forEach((raw, n) => {
    const l = raw.trim(); if (!l) return;
    let m;
    if ((m = l.match(/^pedido\s*(?:n[°ºo]\.?|nro\.?|n[uú]mero)?\s*[:#]?\s*(.+)$/i))) { out.campos.nro = m[1].trim(); return; }
    if ((m = l.match(/^(cliente|vendedor|responsable(?: de l[ií]nea)?|obs\.?|observaciones)\s*:\s*(.*)$/i))) {
      const k = m[1].toLowerCase();
      const campo = k.startsWith("cli") ? "cliente" : k.startsWith("ven") ? "vendedor" : k.startsWith("res") ? "responsable" : "observaciones";
      out.campos[campo] = m[2].trim(); return;
    }
    if (/^(fecha|estado)\s*:/i.test(l)) return;
    const t = l.replace(/[;,\t]/g, " ").split(/\s+/).map(x => x.replace(/^#/, ""));
    const idx = t.findIndex((x, i) => i < 4 && porSku.has(x.toLowerCase()));
    if (idx < 0) { out.problemas.push(`Línea ${n + 1}: ${l}`); return; }
    const art = porSku.get(t[idx].toLowerCase());
    const esX = s => /^[x×*]$/i.test(s || ""), entero = s => /^\d{1,4}$/.test(s || "");
    let cant = 1;
    const prev = (t[idx - 1] || "").replace(/[x×*]$/i, "");
    if (idx > 0 && entero(prev)) cant = +prev;
    else if (idx > 1 && esX(t[idx - 1]) && entero(t[idx - 2])) cant = +t[idx - 2];
    else if (/^[x×*]\d{1,4}$/i.test(t[idx + 1] || "")) cant = +t[idx + 1].slice(1);
    else if (esX(t[idx + 1]) && entero(t[idx + 2])) cant = +t[idx + 2];
    else if (entero(t[idx + 1]) && t.length === idx + 2) cant = +t[idx + 1];
    const ex = out.items.find(x => x.sku === art.sku);
    if (ex) ex.cantidad += Math.max(1, cant); else out.items.push({sku: art.sku, descripcion: art.descripcion, cantidad: Math.max(1, cant)});
  });
  return out;
}
$("btnTxtPed").addEventListener("click", () => {
  if (!S.arts.length) { toast("El catálogo todavía no cargó.", true); return; }
  $("txtPedIn").click();
});
$("txtPedIn").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
  const r = parsePedidoTxt(await leerTexto(file));
  const ids = {nro: "fNro", cliente: "fCli", vendedor: "fVen", responsable: "fResp", observaciones: "fObs"};
  Object.entries(r.campos).forEach(([k, v]) => { if (v) { $(ids[k]).value = v; $(ids[k]).classList.remove("err"); } });
  r.items.forEach(it => { const ex = S.items.find(x => x.sku === it.sku); if (ex) ex.cantidad += it.cantidad; else S.items.push({...it}); });
  renderItems();
  const uds = r.items.reduce((a, b) => a + b.cantidad, 0);
  if (r.problemas.length) {
    dialogoImport("Archivo cargado con avisos",
      `Se agregaron ${r.items.length} piezas (${uds} unidades). Estas líneas no tienen un código del catálogo y se saltearon:`,
      r.problemas, "Revisá el pedido antes de guardarlo. Si es una pieza nueva, primero agregala al catálogo.", false);
  } else toast(r.items.length ? `Se agregaron ${r.items.length} piezas (${uds} unidades)` : "El archivo no tenía piezas para agregar.", !r.items.length);
});
/* Catálogo desde TXT: "CATEGORÍA;CÓDIGO;DESCRIPCIÓN" (o tabulaciones), "CÓDIGO;DESCRIPCIÓN" o "CÓDIGO DESCRIPCIÓN" */
function parseCatTxt(txt){
  const catDef = S.catSel || "SIN CATEGORÍA";
  const filas = new Map(), problemas = [];
  txt.split(/\r?\n/).forEach((raw, n) => {
    const l = raw.trim(); if (!l) return;
    if (n < 2 && /c[oó]digo|sku/i.test(l) && /descrip/i.test(l)) return;
    const p = l.split(/\s*[;\t]\s*/).map(x => x.trim()).filter((x, i, a) => x || i < a.length - 1);
    let cat, sku, desc;
    if (p.length >= 3) { [cat, sku] = p; desc = p.slice(2).join(" "); }
    else if (p.length === 2) { cat = catDef; [sku, desc] = p; }
    else { const m = l.match(/^#?(\S+)\s+(.+)$/); if (m) { cat = catDef; sku = m[1]; desc = m[2]; } }
    sku = (sku || "").replace(/^#/, "").trim(); desc = (desc || "").trim(); cat = (cat || "").trim().toUpperCase();
    if (!sku || !desc || !cat || /\s/.test(sku)) { problemas.push(`Línea ${n + 1}: ${l}`); return; }
    filas.set(sku, {sku, categoria: cat, descripcion: desc});
  });
  return {filas: [...filas.values()], problemas};
}
$("btnTxtCat").addEventListener("click", () => $("txtCatIn").click());
$("txtCatIn").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
  const {filas, problemas} = parseCatTxt(await leerTexto(file));
  const actual = new Map(S.arts.map(a => [a.sku, a]));
  const nuevos = filas.filter(f => !actual.has(f.sku));
  const cambian = filas.filter(f => { const a = actual.get(f.sku); return a && (a.categoria !== f.categoria || a.descripcion !== f.descripcion); });
  const aEscribir = [...nuevos, ...cambian];
  if (!aEscribir.length) {
    dialogoImport("Nada para importar", filas.length ? "Todos los artículos del archivo ya están en el catálogo tal cual." : "No se encontraron artículos en el archivo.",
      problemas, "Formato esperado, una línea por artículo: CATEGORÍA;CÓDIGO;DESCRIPCIÓN", false);
    return;
  }
  const ok = await dialogoImport("Importar artículos",
    `${nuevos.length} nuevos y ${cambian.length} con cambios de categoría o descripción.` + (problemas.length ? " Estas líneas no se pudieron leer:" : ""),
    problemas, `Las líneas sin categoría van a ${S.catSel || "SIN CATEGORÍA"}.`, true);
  if (!ok) return;
  toast("Importando…");
  try {
    for (let i = 0; i < aEscribir.length; i += 400) {
      const batch = S.db.batch();
      aEscribir.slice(i, i + 400).forEach(a => batch.set(S.db.collection("articulos").doc(skuId(a.sku)), a));
      await batch.commit();
    }
    toast(`Catálogo actualizado: ${aEscribir.length} artículos`);
  } catch(err) { toast(errMsg(err), true); }
});

/* ---------- Exportar ---------- */
function csv(filas){ return "\ufeff" + filas.map(f => f.map(v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }).join(";")).join("\r\n"); }
function descargar(nombre, texto){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([texto], {type: "text/csv;charset=utf-8"}));
  a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const hoy = () => new Date().toISOString().slice(0,10);
$("btnCsvPed").hidden = false; $("btnCsvCat").hidden = false;
$("btnCsvPed").addEventListener("click", () => {
  const filas = [["Pedido","Fecha","Estado","Cliente","Vendedor","Responsable","Código","Descripción","Cantidad","Observaciones","Fotos"]];
  pedidosFiltrados().forEach(p => {
    const base = [p.nro, fmtFecha(p.fecha), ESTADO_TXT[p.estado], p.cliente, p.vendedor, p.responsable];
    const its = p.items || [], nf = (p.fotos || []).length;
    if (!its.length) filas.push([...base, "", "", "", p.observaciones, nf]);
    its.forEach(i => filas.push([...base, i.sku, i.descripcion, i.cantidad, p.observaciones, nf]));
  });
  descargar(`pedidos_${hoy()}.csv`, csv(filas));
});
$("btnCsvCat").addEventListener("click", () => {
  descargar(`catalogo_${hoy()}.csv`, csv([["Categoría","Código","Descripción"], ...S.arts.map(a => [a.categoria, a.sku, a.descripcion])]));
});

function renderSugerencias(){
  const uniq = k => [...new Set(S.peds.map(p => p[k]).filter(Boolean))].slice(0,30);
  $("dlVen").innerHTML = uniq("vendedor").map(v => `<option value="${esc(v)}">`).join("");
  $("dlResp").innerHTML = uniq("responsable").map(v => `<option value="${esc(v)}">`).join("");
}

/* ---------- Acceso directo: sin usuario, sin contraseña y sin registrar quién hace cada cosa ---------- */
/* La app entra sola con una sesión anónima de Firebase, solo para que la base acepte los cambios. */
let suscripto = false;
function estado(on, txt){ $("dot").classList.toggle("on", on); $("statusTxt").textContent = txt; }
function pantallaError(msg, puedeReintentar){
  $("loginMsg").textContent = msg; $("btnEntrar").disabled = !puedeReintentar;
  $("login").classList.add("on");
}
function entrar(){
  $("login").classList.remove("on");
  if (suscripto) return;
  suscripto = true; estado(false, "Cargando…");
  suscribirArts(); suscribirPeds();
}
$("nombreForm").addEventListener("submit", e => { e.preventDefault(); location.reload(); });

function errAcceso(e){
  const c = e && e.code;
  if (c === "auth/operation-not-allowed" || c === "auth/admin-restricted-operation")
    return "Falta activar el acceso anónimo en Firebase: Authentication → Método de acceso → Anónimo.";
  if (c === "auth/network-request-failed") return "No hay conexión a internet. Revisá la señal y tocá Reintentar.";
  if (c === "auth/api-key-not-valid" || c === "auth/api-key-not-valid.-please-pass-a-valid-api-key." || c === "auth/invalid-api-key")
    return "La apiKey de config.js no es válida. Copiala de nuevo desde la consola de Firebase, sin espacios.";
  return "No se pudo conectar con la base de datos. " + ((e && e.message) || "");
}

function iniciar(){
  $("fVen").value = lsGet("exo-vendedor") || ""; $("fResp").value = lsGet("exo-responsable") || "";
  irA(location.hash.slice(1) || "orden", false);
  renderItems(); renderHistorial(); renderCatalogo();
  if (!window.firebase || !cfg.apiKey || /PEGAR/.test(cfg.apiKey)) {
    estado(false, "Sin configurar");
    pantallaError("Falta configurar config.js con los datos de Firebase (ver README).", false); return;
  }
  firebase.initializeApp(cfg);
  S.auth = firebase.auth(); S.db = firebase.firestore();
  try { S.db.enablePersistence({synchronizeTabs: true}).catch(() => {}); } catch(e) {}
  S.auth.onAuthStateChanged(user => {
    if (user) { S.user = user; entrar(); return; }
    estado(false, "Conectando…");
    S.auth.signInAnonymously().catch(err => { estado(false, "Sin conexión"); pantallaError(errAcceso(err), true); });
  });
}
iniciar();
})();
