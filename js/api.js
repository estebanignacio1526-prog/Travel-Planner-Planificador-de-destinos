/* =====================================================================
   api.js — Acceso a datos externos con fetch() y Promesas
   ---------------------------------------------------------------------
   Idea clave: fetch(url) NO devuelve los datos directamente; devuelve una
   PROMESA (un objeto que representa un resultado que llegará más tarde).
   Se encadena con:
     .then(fn)    -> fn se ejecuta cuando llegan los datos
     .catch(fn)   -> fn se ejecuta si algo falla (sin red, error HTTP, etc.)
   Todas las funciones de este archivo devuelven una Promesa; app.js las
   consume con .then/.catch y actualiza el DOM.

   Fuentes (ninguna necesita API key):
     - Países:   dataset abierto "mledoze/countries" (la base de REST Countries)
                 servido por jsDelivr.
     - Población: API pública del Banco Mundial.
     - Banderas:  flagcdn.com.
     - Fotos y descripción: Wikipedia (en español, con respaldo en inglés).
   (La API REST Countries v3.1 fue dada de baja y la v5 exige API key.)
   ===================================================================== */

// URLs base. Construir la URL final = base + parámetros (ver cada función).
const DATOS_PAISES_URL = "https://cdn.jsdelivr.net/gh/mledoze/countries@master/dist/countries.json";
const BANCO_MUNDIAL_URL = "https://api.worldbank.org/v2/country";
const WIKI_ES = "https://es.wikipedia.org/api/rest_v1/page";
const WIKI_EN = "https://en.wikipedia.org/api/rest_v1/page";

// El dataset trae las regiones en inglés; aquí se traducen.
const REGIONES = {
  Africa: "África", Americas: "América", Asia: "Asia", Europe: "Europa", Oceania: "Oceanía", Antarctic: "Antártida"
};

/* ---------- Funciones auxiliares ---------- */

// Quita acentos y pasa a minúsculas para comparar nombres ("Japón" == "japon").
// NFD separa cada letra de su acento; la expresión regular borra los acentos sueltos.
function normalizarTexto(t) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// URL de la imagen de la bandera. cca2 = código de 2 letras (JP, ES...). ancho = píxeles.
function urlBandera(cca2, ancho) {
  return `https://flagcdn.com/w${ancho}/${cca2.toLowerCase()}.png`;
}

// Convierte un registro del dataset en un objeto sencillo que usa toda la app.
// Así, si cambia la fuente de datos, solo hay que modificar esta función.
function normalizarPais(p) {
  // currencies viene como { JPY: { name: "Japanese yen" } } -> ["Japanese yen (JPY)"]
  const monedas = p.currencies
    ? Object.entries(p.currencies).map(([codigo, m]) => `${m.name} (${codigo})`)
    : [];
  const espanol = (p.translations && p.translations.spa && p.translations.spa.common) || p.name.common;
  return {
    codigo: p.cca3,                       // identificador único (JPN, ESP...)
    nombre: espanol,                      // nombre que se muestra
    ingles: p.name.common,                // se usa para buscar en Wikipedia
    oficial: p.name.official,
    capital: (p.capital && p.capital[0]) || "Sin capital",
    region: REGIONES[p.region] || p.region || "—",
    subregion: p.subregion || "",
    poblacion: null,                      // se completa después con completarPoblacion()
    area: p.area || 0,
    idiomas: p.languages ? Object.values(p.languages).join(", ") : "—",
    moneda: monedas.join(", ") || "—",
    bandera: urlBandera(p.cca2, 640),
    fronteras: p.borders || []            // códigos de los países vecinos
  };
}

// Envuelve fetch() y revisa el estado HTTP. Devuelve una Promesa con el JSON.
//  - 404            -> Error("NO_ENCONTRADO")
//  - otro error HTTP -> Error("HTTP_xxx")
//  - sin conexión    -> fetch lanza un TypeError por sí solo
function pedirJSON(url) {
  return fetch(url).then((respuesta) => {   // 1) llega la respuesta (aún sin leer el cuerpo)
    if (respuesta.status === 404) throw new Error("NO_ENCONTRADO");
    if (!respuesta.ok) throw new Error("HTTP_" + respuesta.status);
    return respuesta.json();                // 2) json() también devuelve otra Promesa
  });
}

/* =====================================================================
   Dataset de países (se descarga UNA sola vez y se reutiliza)
   ===================================================================== */

let promesaDatos = null; // guarda la promesa para no repetir la descarga

function cargarDatosPaises() {
  if (!promesaDatos) {
    // Si la descarga falla se borra la promesa, para poder reintentar después.
    promesaDatos = pedirJSON(DATOS_PAISES_URL).catch((e) => { promesaDatos = null; throw e; });
  }
  return promesaDatos;
}

// Lista ligera (código, nombres y bandera) para el autocompletado y "Sorpréndeme".
function cargarListaPaises() {
  return cargarDatosPaises().then((datos) =>
    datos
      .map((p) => ({
        codigo: p.cca3,
        ingles: p.name.common,
        espanol: (p.translations && p.translations.spa && p.translations.spa.common) || p.name.common,
        bandera: urlBandera(p.cca2, 80)
      }))
      .sort((a, b) => a.espanol.localeCompare(b.espanol, "es")) // orden alfabético en español
  );
}

// Sugerencias del autocompletado (máximo 6).
// Primero los nombres que EMPIEZAN con lo escrito, luego los que lo CONTIENEN.
function sugerirPaises(texto) {
  const q = normalizarTexto(texto);
  return cargarListaPaises().then((lista) => {
    if (q.length < 1) return [];
    const empieza = [], contiene = [];
    lista.forEach((p) => {
      const es = normalizarTexto(p.espanol), en = normalizarTexto(p.ingles);
      if (es.startsWith(q) || en.startsWith(q)) empieza.push(p);
      else if (es.includes(q) || en.includes(q)) contiene.push(p);
    });
    return empieza.concat(contiene).slice(0, 6);
  });
}

/* =====================================================================
   Consultas de un país
   ===================================================================== */

// Pide la población al Banco Mundial.
// URL = BANCO_MUNDIAL_URL + "/" + código + "/indicator/SP.POP.TOTL?format=json&mrnev=1"
//   SP.POP.TOTL = indicador "población total";  mrnev=1 = dato más reciente disponible.
// NUNCA rechaza: si falla, la población queda en null y la app muestra "No disponible".
function completarPoblacion(pais) {
  return pedirJSON(`${BANCO_MUNDIAL_URL}/${pais.codigo}/indicator/SP.POP.TOTL?format=json&mrnev=1`)
    .then((r) => {
      const dato = r && r[1] && r[1][0]; // la respuesta es [metadatos, [datos]]
      pais.poblacion = dato && dato.value ? dato.value : null;
      return pais;
    })
    .catch(() => pais);
}

// Busca un país por su código (JPN, ESP...). Se usa al pulsar un país relacionado.
function buscarPorCodigo(codigo) {
  return cargarDatosPaises().then((datos) => {
    const p = datos.find((x) => x.cca3 === codigo);
    if (!p) throw new Error("NO_ENCONTRADO");
    return completarPoblacion(normalizarPais(p));
  });
}

// Busca un país por nombre (español o inglés, con o sin acentos).
// Si no existe, la Promesa se rechaza con Error("NO_ENCONTRADO"); app.js lo captura
// en .catch y muestra el mensaje "País inexistente".
function buscarPais(nombre) {
  const q = normalizarTexto(nombre);
  return cargarDatosPaises().then((datos) => {
    // Todos los nombres con los que se conoce un país (normalizados).
    const nombres = (p) => [
      p.name.common, p.name.official,
      p.translations && p.translations.spa && p.translations.spa.common,
      p.translations && p.translations.spa && p.translations.spa.official
    ].concat(p.altSpellings || []).filter(Boolean).map(normalizarTexto);

    // Orden de preferencia: coincidencia exacta > empieza por > contiene (mín. 4 letras).
    const encontrado =
      datos.find((p) => nombres(p).includes(q)) ||
      datos.find((p) => nombres(p).some((n) => n.startsWith(q))) ||
      (q.length >= 4 && datos.find((p) => nombres(p).some((n) => n.includes(q))));

    if (!encontrado) throw new Error("NO_ENCONTRADO");
    return completarPoblacion(normalizarPais(encontrado));
  });
}

// Países relacionados: sus vecinos (fronteras); si no tiene (una isla), los de su subregión.
function obtenerRelacionados(pais) {
  return cargarDatosPaises().then((datos) => {
    let lista;
    if (pais.fronteras.length > 0) {
      lista = datos.filter((p) => pais.fronteras.includes(p.cca3));
    } else if (pais.subregion) {
      lista = datos.filter((p) => p.subregion === pais.subregion);
    } else {
      lista = [];
    }
    return lista.filter((p) => p.cca3 !== pais.codigo).slice(0, 8).map(normalizarPais);
  });
}

/* =====================================================================
   Fotos y descripción (Wikipedia)
   ===================================================================== */

// Pide el resumen de un artículo: { extract (texto), originalimage, thumbnail, title }.
// URL = base + "/summary/" + título del artículo.
function resumenWikipedia(base, titulo) {
  return pedirJSON(`${base}/summary/${encodeURIComponent(titulo.replace(/ /g, "_"))}`)
    .then((r) => {
      // Una página de desambiguación ("Georgia" puede ser varias cosas) no sirve.
      if (r.type === "disambiguation") throw new Error("NO_ENCONTRADO");
      return { base, resumen: r };
    });
}

// Devuelve { foto, descripcion, galeria[] }.
// NUNCA rechaza: si no hay fotos, app.js sigue mostrando la bandera.
// Intenta en este orden: Wikipedia ES (nombre) -> ES (nombre oficial) -> EN (inglés).
// Cada .catch pasa al siguiente intento si el anterior falló.
function obtenerFotos(pais) {
  return resumenWikipedia(WIKI_ES, pais.nombre)
    .catch(() => resumenWikipedia(WIKI_ES, pais.oficial))
    .catch(() => resumenWikipedia(WIKI_EN, pais.ingles))
    .then(({ base, resumen: r }) => {
      const foto = (r.originalimage && r.originalimage.source) || (r.thumbnail && r.thumbnail.source) || null;
      // Segunda petición: lista de imágenes del artículo, para la galería.
      return pedirJSON(`${base}/media-list/${encodeURIComponent(r.title.replace(/ /g, "_"))}`)
        .then((m) => {
          const galeria = (m.items || [])
            .filter((i) => i.type === "image" && i.srcset && i.srcset.length)
            .map((i) => ({
              url: "https:" + i.srcset[i.srcset.length - 1].src, // la versión más grande
              titulo: ((i.title || "") + "").toLowerCase()
            }))
            // Descarta banderas, mapas, escudos y logos (no son fotos del lugar).
            .filter((i) => !/\.svg|flag|bandera|map|mapa|coat_of_arms|escudo|locator|emblem|logo|seal/.test(i.titulo + i.url.toLowerCase()))
            .slice(0, 7)
            .map((i) => i.url);
          return { foto, descripcion: r.extract || "", galeria };
        })
        // Si falla la galería, aún se devuelve la foto principal y la descripción.
        .catch(() => ({ foto, descripcion: r.extract || "", galeria: [] }));
    })
    // Si todo falla: sin fotos ni descripción.
    .catch(() => ({ foto: null, descripcion: "", galeria: [] }));
}
