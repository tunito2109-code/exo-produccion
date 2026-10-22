/* EXO · Control de producción
   Datos y fotos en Supabase. Configuración en config.js. */
(function(){
"use strict";

const cfg = window.EXO_CONFIG || {};
const BUCKET = "fotos";
const ESTADOS = [["pendiente","Pendiente"],["produccion","En producción"],["terminado","Terminado"],["anulado","Anulado"]];
const ESTADO_TXT = Object.fromEntries(ESTADOS);
const S = { sb:null, user:null, arts:[], peds:[], items:[], edit:null,
  hisFiltro:"todos", hisLimite:40, catSel:null, artEdit:null, urls:new Map(), canal:null };

/* ---------- Utilidades ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const fmtFecha = iso => { const d = new Date(iso); return (!iso || isNaN(d)) ? "" :
  d.toLocaleString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); };
const ahoraISO = () => new Date().toISOString();
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
  const code = e && (e.code || e.statusCode);
  if (code === "23505") return "Ya existe un registro con ese número o código.";
  if (code === "42501" || code === "403" || code === 403) return "Tu usuario no tiene permiso para esta acción.";
  if (e && /fetch|network|Failed/i.test(e.message || "")) return "Sin conexión. Revisá internet e intentá de nuevo.";
  return "No se pudo guardar. " + (e && e.message ? e.message : "Intentá de nuevo.");
}
function chk(r){ if (r && r.error) throw r.error; return r ? r.data : null; }

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

/* ---------- Datos ---------- */
const fromRow = r => ({ id:r.id, nro:r.nro, cliente:r.cliente, vendedor:r.vendedor, responsable:r.responsable,
  observaciones:r.observaciones, items:r.items || [], fotos:r.fotos || [], estado:r.estado || "pendiente",
  fecha:r.fecha, actualizado:r.actualizado, terminadoEn:r.terminado_en });

async function cargarArts(){
  const data = chk(await S.sb.from("articulos").select("sku,categoria,descripcion").order("categoria").order("descripcion").limit(10000));
  S.arts = data || [];
  renderCatalogo(); if ($("qPieza").value) buscarPiezas();
}
async function cargarPeds(){
  const data = chk(await S.sb.from("pedidos").select("*").order("fecha", {ascending:false}).limit(1000));
  S.peds = (data || []).map(fromRow);
  renderHistorial(); renderSugerencias();
}
const pend = {};
function programar(que){
  clearTimeout(pend[que]);
  pend[que] = setTimeout(() => (que === "arts" ? cargarArts() : cargarPeds()).catch(() => estado(false, "Reconectando…")), 300);
}
function suscribir(){
  if (S.canal) return;
  S.canal = S.sb.channel("exo-cambios")
    .on("postgres_changes", {event:"*", schema:"public", table:"articulos"}, () => programar("arts"))
    .on("postgres_changes", {event:"*", schema:"public", table:"pedidos"}, () => programar("peds"))
    .subscribe(st => estado(st === "SUBSCRIBED", st === "SUBSCRIBED" ? "En línea" : "Reconectando…"));
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.user) { programar("arts"); programar("peds"); }
});

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
  try {
    if (S.edit) {
      chk(await S.sb.from("pedidos").update(fila).eq("id", S.edit.id));
      toast("Cambios guardados"); limpiarForm(); irA("historial");
    } else {
      chk(await S.sb.from("pedidos").insert({...fila, fecha: ahora, estado: "pendiente", creado_por: S.user.email}));
      lsSet("exo-vendedor", fila.vendedor); lsSet("exo-responsable", fila.responsable);
      toast(`Pedido ${nro} guardado`); limpiarForm();
    }
    await cargarPeds();
  } catch(e) {
    if (e && e.code === "23505") { $("fNro").classList.add("err"); toast(`El pedido ${nro} ya existe.`, true); }
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
$("btnMas").addEventListener("click", () => { S.hisLimite += 40; renderHistorial(); });

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
  $("hisCount").textContent = S.peds.length ? `${lista.length} de ${S.peds.length} pedidos` : "";
  $("btnMas").hidden = lista.length <= S.hisLimite;
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
        ${fotos.length ? `<div class="fotos">${fotos.map((f,i) => `<button type="button" data-act="ver" data-f="${i}" aria-label="Ver foto"><img data-path="${esc(f.path)}" alt="${f.tipo === "hoja" ? "Hoja del pedido" : "Foto del pedido"}"><span class="tag ${f.tipo === "hoja" ? "hoja" : ""}">${f.tipo === "hoja" ? "Hoja" : "Foto"}</span></button>`).join("")}</div>` : ""}
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
  cargarMiniaturas();
}
$("orders").addEventListener("toggle", e => { if (e.target.open) cargarMiniaturas(); }, true);

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
      const paths = (p.fotos || []).map(f => f.path).filter(Boolean);
      chk(await S.sb.from("pedidos").delete().eq("id", p.id));
      if (paths.length) S.sb.storage.from(BUCKET).remove(paths).catch(() => {});
      toast("Pedido eliminado"); await cargarPeds();
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
  if (est === "terminado") upd.terminado_en = ahora;
  try { chk(await S.sb.from("pedidos").update(upd).eq("id", p.id)); toast(`Pedido ${p.nro}: ${est === "terminado" ? "OK" : ESTADO_TXT[est]}`); await cargarPeds(); }
  catch(err) { toast(errMsg(err), true); renderHistorial(); }
}

/* ---------- Fotos ---------- */
let fotoCtx = null, okPedido = null, verCtx = null;

async function urlsFirmadas(paths){
  const ahora = Date.now(), faltan = paths.filter(p => { const c = S.urls.get(p); return !c || c.vence < ahora; });
  if (faltan.length) {
    const r = await S.sb.storage.from(BUCKET).createSignedUrls(faltan, 3600);
    if (!r.error) (r.data || []).forEach(x => { if (x.signedUrl) S.urls.set(x.path, {url: x.signedUrl, vence: ahora + 50*60*1000}); });
  }
  return paths.map(p => (S.urls.get(p) || {}).url);
}
async function cargarMiniaturas(){
  const imgs = [...document.querySelectorAll("details.ord[open] img[data-path]:not([src])")];
  if (!imgs.length) return;
  try {
    const urls = await urlsFirmadas([...new Set(imgs.map(i => i.dataset.path))]);
    const mapa = new Map([...new Set(imgs.map(i => i.dataset.path))].map((p,i) => [p, urls[i]]));
    imgs.forEach(i => { const u = mapa.get(i.dataset.path); if (u) i.src = u; else i.classList.add("broken"); });
  } catch(e) {}
}
document.addEventListener("error", e => { if (e.target && e.target.tagName === "IMG") e.target.classList.add("broken"); }, true);

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
async function comprimir(file){
  try {
    const src = await leerDataURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
    if (b) return b;
  } catch(e) {}
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  throw {message: "Ese formato de imagen no se puede usar. Probá con JPG o PNG."};
}
$("fotoIn").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0]; e.target.value = "";
  const ctx = fotoCtx; fotoCtx = null;
  if (!file || !ctx) return;
  const esHoja = ctx.tipo === "hoja";
  if (esHoja) { $("dlgOk").classList.add("busy"); $("okNote").textContent = "Subiendo foto…"; } else toast("Subiendo foto…");
  try {
    const blob = await comprimir(file);
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${ctx.pid}/${Date.now()}-${ctx.tipo}.${ext}`;
    const up = await S.sb.storage.from(BUCKET).upload(path, blob, {contentType: blob.type || "image/jpeg", upsert: false});
    if (up.error) throw up.error;
    // Leer el pedido actualizado para no pisar fotos que otro haya agregado
    const actual = chk(await S.sb.from("pedidos").select("fotos").eq("id", ctx.pid).single());
    const ahora = ahoraISO();
    const upd = { fotos: [...((actual && actual.fotos) || []), {path, tipo: ctx.tipo, fecha: ahora, por: S.user.email}], actualizado: ahora };
    if (esHoja) { upd.estado = "terminado"; upd.terminado_en = ahora; }
    chk(await S.sb.from("pedidos").update(upd).eq("id", ctx.pid));
    await cargarPeds();
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
  verCtx = {pid: p.id, path: f.path};
  $("verImg").removeAttribute("src");
  $("verImg").alt = f.tipo === "hoja" ? "Hoja del pedido" : "Foto del pedido";
  $("verTxt").textContent = `${f.tipo === "hoja" ? "Hoja del pedido" : "Foto"} · pedido ${p.nro} · ${fmtFecha(f.fecha)}${f.por ? " · " + f.por : ""}`;
  $("dlgVer").showModal();
  const [u] = await urlsFirmadas([f.path]); if (u) $("verImg").src = u;
}
$("verCerrar").addEventListener("click", () => $("dlgVer").close());
$("verQuitar").addEventListener("click", async () => {
  const ctx = verCtx; $("dlgVer").close(); if (!ctx) return;
  const p = S.peds.find(x => x.id === ctx.pid); if (!p) return;
  const f = (p.fotos || []).find(x => x.path === ctx.path);
  const aviso = f && f.tipo === "hoja" ? "Es la foto de la hoja: el pedido va a quedar como OK sin foto." : "La foto se borra para todos.";
  if (!(await confirmar("Quitar foto", aviso, "Quitar"))) return;
  try {
    chk(await S.sb.from("pedidos").update({fotos: (p.fotos || []).filter(x => x.path !== ctx.path), actualizado: ahoraISO()}).eq("id", p.id));
    S.sb.storage.from(BUCKET).remove([ctx.path]).catch(() => {});
    toast("Foto quitada"); await cargarPeds();
  } catch(err) { toast(errMsg(err), true); }
});

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
    : `<li class="empty" style="border:0">${S.arts.length ? "No hay artículos con ese filtro." : "El catálogo está vacío. Agregá el primer artículo o importá un TXT."}</li>`;
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
    chk(await S.sb.from("articulos").upsert({sku, categoria: cat, descripcion: desc}));
    if (S.artEdit && S.artEdit.sku !== sku) chk(await S.sb.from("articulos").delete().eq("sku", S.artEdit.sku));
    $("dlgArt").close(); toast(S.artEdit ? "Artículo actualizado" : "Artículo agregado"); await cargarArts();
  } catch(err) { toast(errMsg(err), true); }
});
$("artDel").addEventListener("click", async () => {
  const a = S.artEdit; if (!a) return;
  $("dlgArt").close();
  if (!(await confirmar(`Eliminar #${a.sku}`, `${a.descripcion}. Los pedidos ya cargados con esta pieza no cambian.`))) return;
  try { chk(await S.sb.from("articulos").delete().eq("sku", a.sku)); toast("Artículo eliminado"); await cargarArts(); }
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
    for (let i = 0; i < aEscribir.length; i += 500) chk(await S.sb.from("articulos").upsert(aEscribir.slice(i, i + 500)));
    toast(`Catálogo actualizado: ${aEscribir.length} artículos`); await cargarArts();
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

/* ---------- Ingreso y arranque ---------- */
function estado(on, txt){ $("dot").classList.toggle("on", on); $("statusTxt").textContent = txt; }
function mostrarLogin(msg){ $("login").classList.add("on"); $("loginMsg").textContent = msg || ""; setTimeout(() => $("lEmail").focus(), 50); }

async function entrar(user){
  S.user = user;
  $("login").classList.remove("on");
  $("userTxt").textContent = user.email || ""; $("btnSalir").hidden = false;
  estado(false, "Cargando…");
  try { await Promise.all([cargarArts(), cargarPeds()]); estado(true, "En línea"); }
  catch(e) { estado(false, "Sin conexión"); toast(errMsg(e), true); }
  suscribir();
}
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("btnEntrar"); btn.disabled = true; $("loginMsg").textContent = "";
  try {
    const r = await S.sb.auth.signInWithPassword({email: $("lEmail").value.trim(), password: $("lPass").value});
    if (r.error) { $("loginMsg").textContent = /invalid/i.test(r.error.message) ? "Email o contraseña incorrectos." : r.error.message; return; }
    $("lPass").value = "";
    entrar(r.data.user);
  } catch(err) { $("loginMsg").textContent = "No hay conexión con el servidor."; }
  finally { btn.disabled = false; }
});
$("btnSalir").addEventListener("click", async () => {
  if (!(await confirmar("Cerrar sesión", "Vas a tener que volver a ingresar con tu email y contraseña.", "Salir"))) return;
  await S.sb.auth.signOut(); location.reload();
});

async function iniciar(){
  $("fVen").value = lsGet("exo-vendedor") || ""; $("fResp").value = lsGet("exo-responsable") || "";
  irA(location.hash.slice(1) || "orden", false);
  renderItems(); renderHistorial(); renderCatalogo();
  if (!window.supabase || !cfg.url || !cfg.anonKey || /TU-PROYECTO/.test(cfg.url)) {
    estado(false, "Sin configurar");
    mostrarLogin("Falta configurar config.js con los datos de Supabase (ver README).");
    $("btnEntrar").disabled = true; return;
  }
  S.sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  S.sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT" && S.user) location.reload(); });
  const { data } = await S.sb.auth.getSession();
  if (data && data.session) entrar(data.session.user); else { estado(false, "Sin sesión"); mostrarLogin(); }
}
iniciar();
})();
