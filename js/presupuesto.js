/* =====================================================================
   presupuesto.js — Cálculo del presupuesto
   ---------------------------------------------------------------------
   Funciones "puras": reciben números y devuelven un resultado.
   No tocan el DOM; app.js se encarga de mostrar lo que devuelven.
   ===================================================================== */

// Presupuesto total de UN destino = días × presupuesto diario.
// Ejemplo: 7 días × $50 = $350.
function calcularPresupuestoDestino(dias, presupuestoDiario) {
  return dias * presupuestoDiario;
}

// Totales de TODO el plan. reduce() recorre el arreglo acumulando:
//   acc.dias  -> suma de los días de todos los destinos
//   acc.total -> suma del presupuesto de cada destino
// Empieza en { dias: 0, total: 0 } (último argumento de reduce).
function calcularResumenPlan(destinos) {
  return destinos.reduce(
    (acc, d) => {
      acc.dias += d.dias;
      acc.total += calcularPresupuestoDestino(d.dias, d.presupuestoDiario);
      return acc;
    },
    { dias: 0, total: 0 }
  );
}

// Da formato de dinero: 1234.5 -> "$1.234,50" (separadores en español, 2 decimales).
function formatearDinero(valor) {
  return "$" + valor.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
