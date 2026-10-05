/* =====================================================================
   app.js — Lógica de la interfaz
   ---------------------------------------------------------------------
   Este archivo se encarga de:
     1. Escuchar los EVENTOS del usuario (escribir, enviar el formulario,
        hacer clic en botones). Cada función que se pasa a addEventListener
        es un CALLBACK: el navegador la ejecuta cuando ocurre el evento.
     2. Llamar a las funciones de api.js (que usan fetch + Promesas).
     3. Actualizar el DOM con los resultados.
     4. Manejar la lista de destinos y recalcular el presupuesto
        (las fórmulas están en presupuesto.js).

   El HTML NO se escribe aquí: vive en index.html dentro de etiquetas
   <template>. Aquí solo se clona la plantilla y se rellena con datos.
   ===================================================================== */

// Clave con la que se guarda el plan en el navegador (localStorage).
const STORAGE_KEY = "travel-planner-destinos";
// Colores que se asignan, en orden, a cada destino (borde, barra y leyenda).
const COLORES = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

/* ---------- Referencias a elementos del DOM ---------- */
// Se buscan una sola vez al cargar la página y se reutilizan.
const form = document.getElementById("form-busqueda");
const inputPais = document.getElementById("input-pais");
const btnBuscar = document.getElementById("btn-buscar");
const errorValidacion = document.getElementById("error-validacion"); // mensaje bajo el input
const estado = document.getElementById("estado");                    // cargando / vacío / error
const resultado = document.getElementById("resultado");              // tarjeta del país
const relacionadosBloque = document.getElementById("relacionados-bloque");
const relacionadosDiv = document.getElementById("relacionados");
const listaDestinos = document.getElementById("lista-destinos");     // <ul> del plan
const planVacio = document.getElementById("plan-vacio");             // mensaje "sin destinos"
const resumen = document.getElementById("resumen");                  // totales del plan
const btnLimpiar = document.getElementById("btn-limpiar");
const cajaSugerencias = document.getElementById("sugerencias");      // lista del autocompletado

/* ---------- Estado de la aplicación ---------- */
let paisActual = null;    // país que se está mostrando en pantalla
let fotosActuales = null; // fotos/descripcion de ese país (llegan después, de Wikipedia)
let busquedaId = 0;       // contador: evita que una respuesta lenta pise a una más reciente
let destinos = cargarDestinos(); // plan de viaje (se recupera de localStorage al abrir)

/* =====================================================================
   Utilidades
   ===================================================================== */

// Devuelve una copia de una <template> de index.html lista para modificar.
function clonar(idPlantilla) {
  return document.getElementById(idPlantilla).content.cloneNode(true);
}

// Escribe texto en los elementos que tengan data-campo="nombre".
// Ejemplo: rellenar(frag, { capital: "Tokio" }) -> <b data-campo="capital">Tokio</b>
// Se usa textContent (no innerHTML) para que ningún dato pueda inyectar HTML.
function rellenar(raiz, datos) {
  Object.entries(datos).forEach(([campo, valor]) => {
    const el = raiz.querySelector(`[data-campo="${campo}"]`);
    if (el) el.textContent = valor;
  });
}

// Cambia el recuadro de estado. tipo: "cargando" | "error" | "vacio" | "ok" (se oculta).
// El aspecto de cada tipo está en el CSS (.estado-cargando, .estado-error, ...).
function mostrarEstado(tipo, mensaje) {
  estado.className = "estado estado-" + tipo;
  estado.textContent = mensaje;
}

// Muestra un aviso temporal abajo. Si recibe "accion" añade un botón (ej. "Deshacer").
function mostrarToast(mensaje, accion) {
  const frag = clonar("tpl-toast");
  const t = frag.querySelector(".toast");
  rellenar(frag, { mensaje });
  if (accion) {
    const b = frag.querySelector("button");
    b.textContent = accion.texto;
    b.hidden = false;
    // CALLBACK: se ejecuta cuando el usuario pulsa el botón del aviso.
    b.addEventListener("click", () => { accion.callback(); t.remove(); });
  }
  document.getElementById("toasts").appendChild(frag);
  // Primero se desvanece (clase "salida") y luego se elimina del DOM.
  setTimeout(() => t.classList.add("salida"), accion ? 5000 : 2800);
  setTimeout(() => t.remove(), accion ? 5400 : 3200);
}

/* =====================================================================
   Autocompletado (sugerencias mientras se escribe)
   ===================================================================== */

let sugerenciaActiva = -1; // posición de la sugerencia resaltada con las flechas

function cerrarSugerencias() {
  cajaSugerencias.hidden = true;
  inputPais.setAttribute("aria-expanded", "false");
  sugerenciaActiva = -1;
}

// EVENTO "input": se dispara con cada letra escrita.
inputPais.addEventListener("input", () => {
  inputPais.classList.remove("invalido");
  errorValidacion.textContent = "";
  const texto = inputPais.value;
  if (!texto.trim()) return cerrarSugerencias();

  // sugerirPaises() devuelve una Promesa; .then recibe la lista cuando está lista.
  sugerirPaises(texto).then((lista) => {
    // Si el usuario siguió escribiendo mientras tanto, esta respuesta ya no sirve.
    if (inputPais.value !== texto || lista.length === 0) return cerrarSugerencias();
    cajaSugerencias.replaceChildren();
    lista.forEach((p) => {
      const frag = clonar("tpl-sugerencia");
      const li = frag.querySelector("li");
      frag.querySelector("img").src = p.bandera;
      // Muestra el nombre en inglés solo si es distinto del español.
      rellenar(frag, { espanol: p.espanol, ingles: p.espanol !== p.ingles ? p.ingles : "" });
      // Se usa "mousedown" y no "click" porque el input pierde el foco (blur)
      // antes del click y cerraría la lista sin dar tiempo a elegir.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        inputPais.value = p.espanol;
        cerrarSugerencias();
        ejecutarBusqueda(p.espanol);
      });
      cajaSugerencias.appendChild(li);
    });
    cajaSugerencias.hidden = false;
    inputPais.setAttribute("aria-expanded", "true");
  }).catch(cerrarSugerencias);
});

// EVENTO "keydown": navegación con teclado por la lista de sugerencias.
inputPais.addEventListener("keydown", (e) => {
  const items = cajaSugerencias.querySelectorAll("li");
  if (cajaSugerencias.hidden || items.length === 0) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    // El módulo (%) hace que al llegar al final vuelva al principio y viceversa.
    sugerenciaActiva = (sugerenciaActiva + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("activa", i === sugerenciaActiva));
  } else if (e.key === "Enter" && sugerenciaActiva >= 0) {
    e.preventDefault();
    items[sugerenciaActiva].dispatchEvent(new MouseEvent("mousedown")); // simula elegirla con el ratón
  } else if (e.key === "Escape") {
    cerrarSugerencias();
  }
});
// Al salir del input se cierra la lista.
inputPais.addEventListener("blur", cerrarSugerencias);

/* =====================================================================
   Búsqueda de un país
   Flujo: validación -> fetch (api.js) -> promesa -> DOM
   ===================================================================== */

// EVENTO "submit" del formulario (Enter o botón Buscar). Este es el CALLBACK principal.
form.addEventListener("submit", (evento) => {
  evento.preventDefault(); // evita que el navegador recargue la página
  const nombre = inputPais.value.trim();

  // --- Validaciones antes de llamar a la API ---
  if (nombre.length < 2) {
    errorValidacion.textContent = "Escribe al menos 2 caracteres.";
    inputPais.classList.add("invalido");
    return;
  }
  // Solo letras (cualquier idioma), espacios, punto, apóstrofe y guion.
  if (!/^[\p{L}\s.'-]+$/u.test(nombre)) {
    errorValidacion.textContent = "Usa solo letras (sin números ni símbolos).";
    inputPais.classList.add("invalido");
    return;
  }
  cerrarSugerencias();
  ejecutarBusqueda(nombre);
});

// Botones de ejemplo ("Japón", "Italia"...): leen su país desde data-pais en el HTML.
document.querySelectorAll(".chip-ejemplo[data-pais]").forEach((b) => {
  b.addEventListener("click", () => {
    inputPais.value = b.dataset.pais;
    ejecutarBusqueda(b.dataset.pais);
  });
});

// Botón "Sorpréndeme": elige un país al azar de la lista completa.
document.getElementById("btn-azar").addEventListener("click", () => {
  cargarListaPaises()
    .then((lista) => {
      const p = lista[Math.floor(Math.random() * lista.length)];
      inputPais.value = p.espanol;
      ejecutarBusqueda(p.espanol);
    })
    .catch(() => mostrarEstado("error", "No se pudo cargar la lista de países. Revisa tu conexión."));
});

// Lanza la búsqueda y gestiona los 3 estados: cargando, éxito y error.
function ejecutarBusqueda(nombre) {
  const id = ++busquedaId;                         // identifica ESTA búsqueda
  mostrarEstado("cargando", `Buscando «${nombre}»…`); // estado: búsqueda en curso
  btnBuscar.disabled = true;                       // evita doble envío
  resultado.hidden = true;
  relacionadosBloque.hidden = true;

  // buscarPais() devuelve una PROMESA. Se encadena con .then / .catch / .finally:
  buscarPais(nombre)
    .then((pais) => {                // se ejecuta si la promesa se cumple (hay datos)
      if (id !== busquedaId) return; // llegó otra búsqueda después: se ignora esta
      mostrarPais(pais);
      mostrarEstado("ok", "");       // oculta el recuadro de estado
    })
    .catch((error) => {              // se ejecuta si la promesa se rechaza (país inexistente, sin red...)
      if (id !== busquedaId) return;
      mostrarEstado("error", mensajeDeError(error, nombre));
    })
    .finally(() => {                 // se ejecuta siempre, haya salido bien o mal
      btnBuscar.disabled = false;
    });
}

// Dibuja el país al instante y completa fotos y relacionados cuando lleguen.
// Son tres peticiones independientes: así la pantalla no espera a la más lenta.
function mostrarPais(pais) {
  const id = ++busquedaId;
  paisActual = pais;
  fotosActuales = null;
  renderPais(pais);
  relacionadosBloque.hidden = true;

  obtenerFotos(pais).then((fotos) => {
    if (id !== busquedaId) return;
    fotosActuales = fotos;
    renderFotos(fotos);
  });
  obtenerRelacionados(pais)
    .then((lista) => { if (id === busquedaId) renderRelacionados(lista); })
    .catch(() => { relacionadosBloque.hidden = true; });
}

// Convierte un error técnico en un mensaje comprensible para el usuario.
function mensajeDeError(error, nombre) {
  if (error.message === "NO_ENCONTRADO") {
    // El país no existe.
    return `😕 No encontramos ningún país llamado «${nombre}». Revisa la ortografía o elige una sugerencia de la lista.`;
  }
  if (error instanceof TypeError) {
    // fetch lanza TypeError cuando no hay conexión.
    return "📡 Problema de conexión. Verifica tu internet e inténtalo de nuevo.";
  }
  // Cualquier otro fallo (por ejemplo, el servidor respondió con error).
  return `⚠️ El servicio no respondió correctamente (${error.message}). Inténtalo más tarde.`;
}

/* =====================================================================
   Dibujar el país en pantalla (DOM)
   ===================================================================== */

// Construye la tarjeta del país a partir de la plantilla "tpl-pais".
function renderPais(p) {
  const yaAgregado = destinos.some((d) => d.codigo === p.codigo);
  const frag = clonar("tpl-pais");

  // Rellena los textos (los data-campo de la plantilla).
  rellenar(frag, {
    nombre: p.nombre,
    oficial: p.oficial,
    capital: p.capital,
    region: p.subregion || p.region,
    poblacion: p.poblacion ? p.poblacion.toLocaleString("es-ES") : "No disponible",
    moneda: p.moneda,
    idiomas: p.idiomas,
    area: p.area.toLocaleString("es-ES") + " km²"
  });
  // Bandera pequeña, y como foto de fondo provisional hasta que llegue la de Wikipedia.
  const banderaImg = frag.querySelector('[data-campo="bandera"]');
  banderaImg.src = p.bandera;
  banderaImg.alt = "Bandera de " + p.nombre;
  frag.querySelector("#hero").style.backgroundImage = `url('${p.bandera}')`;

  // Botón "Agregar al plan": se desactiva si el país ya está en la lista.
  const btnAgregar = frag.querySelector("#btn-agregar");
  btnAgregar.disabled = yaAgregado;
  btnAgregar.textContent = yaAgregado ? "✓ Ya está en tu plan" : "➕ Agregar al plan";
  btnAgregar.addEventListener("click", () => agregarDestino(p)); // CALLBACK del clic

  // Reemplaza el contenido anterior por la nueva tarjeta.
  resultado.replaceChildren(frag);
  resultado.hidden = false;
  // Reinicia la animación CSS "aparece" (quitar clase, forzar reflow, volver a ponerla).
  resultado.classList.remove("aparece");
  void resultado.offsetWidth;
  resultado.classList.add("aparece");
}

// Cambia la imagen grande de la tarjeta.
function ponerFondoHero(url) {
  const hero = document.getElementById("hero");
  if (hero) hero.style.backgroundImage = `url('${url}')`;
}

// Completa la tarjeta con la descripción y las fotos (cuando llegan de Wikipedia).
function renderFotos(fotos) {
  const desc = document.getElementById("descripcion");
  if (desc) desc.textContent = fotos.descripcion || "Sin descripción disponible.";
  if (fotos.foto) ponerFondoHero(fotos.foto);

  const galeria = document.getElementById("galeria");
  // Une la foto principal con la galería y quita repetidas.
  const todas = [fotos.foto].concat(fotos.galeria).filter(Boolean);
  const unicas = todas.filter((u, i) => todas.indexOf(u) === i);
  if (!galeria || unicas.length < 2) return; // con una sola foto no hace falta galería

  galeria.replaceChildren();
  unicas.forEach((url, i) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = `Foto ${i + 1} de ${paisActual.nombre}`;
    img.loading = "lazy"; // carga la miniatura solo cuando se necesita
    img.addEventListener("error", () => img.remove()); // si una foto falla, se quita
    // CALLBACK: al hacer clic en una miniatura se cambia la foto principal.
    img.addEventListener("click", () => {
      ponerFondoHero(url);
      galeria.querySelectorAll("img").forEach((x) => x.classList.toggle("activa", x === img));
      if (fotosActuales) fotosActuales.foto = url; // recuerda la elegida para el plan
    });
    if (i === 0) img.classList.add("activa");
    galeria.appendChild(img);
  });
  galeria.hidden = false;
}

// Dibuja los países relacionados (vecinos) como botones con su bandera.
function renderRelacionados(lista) {
  relacionadosDiv.replaceChildren();
  if (lista.length === 0) {
    relacionadosBloque.hidden = true;
    return;
  }
  lista.forEach((p) => {
    const frag = clonar("tpl-chip");
    const chip = frag.querySelector("button");
    frag.querySelector("img").src = p.bandera;
    rellenar(frag, { nombre: p.nombre });
    // CALLBACK: al pulsar un país relacionado se carga su información completa.
    chip.addEventListener("click", () => {
      inputPais.value = p.nombre;
      buscarPorCodigo(p.codigo).then((completo) => {
        mostrarPais(completo);
        resultado.scrollIntoView({ behavior: "smooth", block: "start" });
      }).catch((e) => mostrarEstado("error", mensajeDeError(e, p.nombre)));
    });
    relacionadosDiv.appendChild(frag);
  });
  relacionadosBloque.hidden = false;
}

/* =====================================================================
   Plan de destinos
   Cada destino es un objeto { codigo, nombre, ..., dias, presupuestoDiario }
   ===================================================================== */

// RF04: agrega el país al plan con valores por defecto (7 días, $50 al día).
function agregarDestino(p) {
  if (destinos.some((d) => d.codigo === p.codigo)) return; // no se permiten repetidos
  destinos.push({
    codigo: p.codigo,
    nombre: p.nombre,
    capital: p.capital,
    region: p.region,
    poblacion: p.poblacion,
    moneda: p.moneda,
    bandera: p.bandera,
    foto: (fotosActuales && fotosActuales.foto) || p.bandera, // foto para la tarjeta del plan
    dias: 7,
    presupuestoDiario: 50
  });
  guardarDestinos();
  renderPlan(p.codigo);  // el código sirve para animar solo el destino nuevo
  renderPais(p);         // refresca el botón a "Ya está en tu plan"
  if (fotosActuales) renderFotos(fotosActuales);
  mostrarToast(`${p.nombre} agregado al plan ✈️`);
}

// RF07: elimina un destino. Ofrece "Deshacer" durante unos segundos.
function eliminarDestino(codigo) {
  const indice = destinos.findIndex((d) => d.codigo === codigo);
  if (indice < 0) return;
  // splice quita el elemento del arreglo y lo devuelve (para poder restaurarlo).
  const [quitado] = destinos.splice(indice, 1);
  const li = listaDestinos.querySelector(`[data-codigo="${codigo}"]`);

  // Lo que ocurre tras la animación de salida: guardar y volver a dibujar.
  const terminar = () => {
    guardarDestinos();
    renderPlan();
    if (paisActual && paisActual.codigo === codigo) {
      renderPais(paisActual); // el botón vuelve a "Agregar al plan"
      if (fotosActuales) renderFotos(fotosActuales);
    }
  };
  // Primero se anima la salida (clase CSS) y 250 ms después se actualiza el DOM.
  if (li) { li.classList.add("saliendo"); setTimeout(terminar, 250); } else terminar();

  mostrarToast(`${quitado.nombre} eliminado`, {
    texto: "Deshacer",
    callback: () => {
      // Reinserta el destino en su posición original.
      destinos.splice(Math.min(indice, destinos.length), 0, quitado);
      guardarDestinos();
      renderPlan();
      if (paisActual) { renderPais(paisActual); if (fotosActuales) renderFotos(fotosActuales); }
    }
  });
}

// Botón "Vaciar plan": guarda una copia para poder deshacer.
btnLimpiar.addEventListener("click", () => {
  const copia = destinos.slice();
  destinos = [];
  guardarDestinos();
  renderPlan();
  if (paisActual) { renderPais(paisActual); if (fotosActuales) renderFotos(fotosActuales); }
  mostrarToast("Plan vaciado", {
    texto: "Deshacer",
    callback: () => {
      destinos = copia;
      guardarDestinos();
      renderPlan();
      if (paisActual) { renderPais(paisActual); if (fotosActuales) renderFotos(fotosActuales); }
    }
  });
});

// Dibuja TODA la lista de destinos desde el arreglo "destinos".
// nuevoCodigo (opcional): destino recién agregado, para darle animación de entrada.
function renderPlan(nuevoCodigo) {
  listaDestinos.replaceChildren(); // limpia la lista antes de redibujar
  // Muestra u oculta los bloques según haya destinos o no (estado "vacío").
  planVacio.hidden = destinos.length > 0;
  resumen.hidden = destinos.length === 0;
  btnLimpiar.hidden = destinos.length === 0;

  destinos.forEach((d, i) => {
    const frag = clonar("tpl-destino");
    const li = frag.querySelector("li");
    if (d.codigo === nuevoCodigo) li.classList.add("nuevo");
    li.dataset.codigo = d.codigo; // permite encontrar este <li> luego (para eliminarlo)
    li.style.setProperty("--color", COLORES[i % COLORES.length]); // variable CSS del borde
    li.querySelector(".destino-foto").style.backgroundImage = `url('${d.foto || d.bandera}')`;
    const bandera = li.querySelector('[data-campo="bandera"]');
    bandera.src = d.bandera;
    bandera.alt = "Bandera de " + d.nombre;
    li.querySelector(".eliminar").setAttribute("aria-label", "Eliminar " + d.nombre);
    rellenar(li, { nombre: d.nombre, detalle: `${d.capital} · ${d.moneda}` });

    // Campos editables: días de viaje y presupuesto diario (RF05).
    const inDias = li.querySelector(".in-dias");
    const inDiario = li.querySelector(".in-diario");
    inDias.value = d.dias;
    inDiario.value = d.presupuestoDiario;
    const refrescar = () => actualizarCampo(d, li, inDias, inDiario);

    // CALLBACKS: botón eliminar y cambios en los campos.
    li.querySelector(".eliminar").addEventListener("click", () => eliminarDestino(d.codigo));
    inDias.addEventListener("input", refrescar);   // recalcula en cada tecla
    inDiario.addEventListener("input", refrescar);

    // Botones − y +: [contenedor, input, paso, valor mínimo].
    // Días cambian de 1 en 1 (mínimo 1); el presupuesto de 5 en 5 (mínimo 0).
    const pasos = li.querySelectorAll(".stepper");
    [[pasos[0], inDias, 1, 1], [pasos[1], inDiario, 5, 0]].forEach(([cont, input, paso, minimo]) => {
      cont.querySelector(".menos").addEventListener("click", () => {
        input.value = Math.max(minimo, (Number(input.value) || 0) - paso);
        refrescar(); // reutiliza el mismo cálculo que al escribir
      });
      cont.querySelector(".mas").addEventListener("click", () => {
        input.value = (Number(input.value) || 0) + paso;
        refrescar();
      });
    });

    listaDestinos.appendChild(frag);
    pintarTotalDestino(d, li);
  });

  pintarResumen();
}

// Se ejecuta cada vez que cambian los días o el presupuesto diario (RF05 y RF06).
// Valida, actualiza el dato y recalcula SIN redibujar la lista (así el input no pierde el foco).
function actualizarCampo(d, li, inDias, inDiario) {
  const dias = Number(inDias.value);
  const diario = Number(inDiario.value);
  // Días: entero entre 1 y 365. Presupuesto: número >= 0 y no vacío.
  const diasOk = Number.isInteger(dias) && dias >= 1 && dias <= 365;
  const diarioOk = inDiario.value !== "" && diario >= 0;

  // Marca en rojo el campo inválido (clase CSS "invalido").
  inDias.classList.toggle("invalido", !diasOk);
  inDiario.classList.toggle("invalido", !diarioOk);

  // Solo se guardan valores válidos; así el cálculo nunca usa datos incorrectos.
  if (diasOk) d.dias = dias;
  if (diarioOk) d.presupuestoDiario = diario;

  guardarDestinos();
  pintarTotalDestino(d, li); // total de este destino
  pintarResumen();           // total general
}

// Muestra "7 días × $50.00 = $350.00" en la tarjeta del destino.
function pintarTotalDestino(d, li) {
  const total = calcularPresupuestoDestino(d.dias, d.presupuestoDiario); // presupuesto.js
  rellenar(li, {
    calculo: `${d.dias} días × ${formatearDinero(d.presupuestoDiario)} =`,
    total: formatearDinero(total)
  });
}

// Anima el número del total general desde su valor anterior hasta el nuevo (350 ms).
let totalMostrado = 0;
function animarTotal(destino) {
  const el = document.getElementById("total-general");
  const inicio = totalMostrado, t0 = performance.now();
  totalMostrado = destino;
  function paso(t) {
    const k = Math.min(1, (t - t0) / 350); // progreso de 0 a 1
    el.textContent = formatearDinero(inicio + (destino - inicio) * k); // interpolación lineal
    if (k < 1) requestAnimationFrame(paso); // siguiente fotograma
  }
  requestAnimationFrame(paso);
}

// Actualiza el resumen: cantidad de destinos, días totales, total general y barra de reparto.
function pintarResumen() {
  const r = calcularResumenPlan(destinos); // { dias, total } — presupuesto.js
  document.getElementById("total-destinos").textContent = destinos.length;
  document.getElementById("total-dias").textContent = r.dias;
  animarTotal(r.total);

  // Barra de colores: cada tramo es el % del presupuesto total que usa ese destino.
  const barra = document.getElementById("barra-reparto");
  const leyenda = document.getElementById("leyenda-reparto");
  barra.replaceChildren();
  leyenda.replaceChildren();
  destinos.forEach((d, i) => {
    const color = COLORES[i % COLORES.length];
    const monto = calcularPresupuestoDestino(d.dias, d.presupuestoDiario);
    // Si el total es 0 se reparte en partes iguales para evitar dividir entre cero.
    const pct = r.total > 0 ? (monto / r.total) * 100 : 100 / destinos.length;

    const segFrag = clonar("tpl-segmento");
    const seg = segFrag.querySelector("span");
    seg.style.width = pct + "%";
    seg.style.background = color;
    seg.title = `${d.nombre}: ${pct.toFixed(0)}%`;
    barra.appendChild(segFrag);

    const itemFrag = clonar("tpl-leyenda");
    itemFrag.querySelector("i").style.background = color;
    rellenar(itemFrag, { texto: `${d.nombre} ${pct.toFixed(0)}%` });
    leyenda.appendChild(itemFrag);
  });
}

/* =====================================================================
   Persistencia: el plan se guarda en el navegador (localStorage)
   para que no se pierda al recargar la página.
   ===================================================================== */

function guardarDestinos() {
  // try/catch: localStorage puede estar bloqueado (modo privado, etc.).
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(destinos)); } catch (e) { /* sin storage */ }
}

function cargarDestinos() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

/* ---------- Arranque ---------- */
renderPlan(); // dibuja el plan guardado (o el mensaje de "sin destinos")
// Precarga la lista de países para que el autocompletado responda rápido.
cargarListaPaises().catch(() => { /* las sugerencias son opcionales */ });
