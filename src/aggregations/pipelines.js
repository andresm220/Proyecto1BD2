const { getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');

/**
 * Aggregation Pipelines — procesan documentos en etapas secuenciales.
 * Cada etapa transforma los datos y los pasa a la siguiente, como una línea de producción:
 *   $match  → filtra documentos (como WHERE en SQL)
 *   $group  → agrupa y calcula totales (como GROUP BY en SQL)
 *   $sort   → ordena resultados (como ORDER BY en SQL)
 *   $lookup → une colecciones (como JOIN en SQL)
 *   $unwind → "explota" un array: 1 doc con 3 items → 3 docs separados
 *   $project → selecciona qué campos mostrar en el resultado final
 *   $limit  → limita la cantidad de resultados
 */

// =====================================================
// PIPELINE SIMPLE: Conteo de órdenes por estado
// =====================================================

/**
 * conteoOrdenesPorEstado(restauranteId) — cuenta cuántas órdenes hay en cada estado.
 * Pipeline: $match → $group → $sort
 *
 * @param {ObjectId} restauranteId - ID del restaurante a consultar
 * @returns {Array} - [{ _id: 'pendiente', total: 5 }, { _id: 'pagado', total: 12 }, ...]
 */
async function conteoOrdenesPorEstado(restauranteId) {
  try {
    const db = getDb();
    const resultados = await db.collection('ordenes').aggregate([
      // Etapa 1: $match — filtra solo las órdenes de este restaurante
      { $match: { restaurante_id: restauranteId } },
      // Etapa 2: $group — agrupa por estado y cuenta cuántas hay en cada grupo
      // _id: '$estado' define el campo de agrupación
      // $sum: 1 cuenta 1 por cada documento del grupo
      { $group: { _id: '$estado', total: { $sum: 1 } } },
      // Etapa 3: $sort — ordena de mayor a menor cantidad
      { $sort: { total: -1 } }
    ]).toArray();

    console.log('Conteo de ordenes por estado:');
    resultados.forEach(r => {
      console.log(`  ${r._id}: ${r.total} ordenes`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'pipeline conteo ordenes por estado') || [];
  }
}

// =====================================================
// PIPELINE COMPLEJA 1: Top 5 platillos más vendidos
// =====================================================

/**
 * top5Platillos() — encuentra los 5 platillos más vendidos del sistema.
 * Pipeline: $match → $unwind → $group → $sort → $limit → $lookup → $project
 *
 * $unwind "explota" el array items: si una orden tiene 3 items,
 * genera 3 documentos separados (uno por cada item).
 * Luego $group los agrupa por platillo y suma las cantidades.
 *
 * @returns {Array} - Top 5 platillos con nombre, total vendido e ingresos
 */
async function top5Platillos() {
  try {
    const db = getDb();
    const resultados = await db.collection('ordenes').aggregate([
      // Etapa 1: solo órdenes pagadas (las canceladas no cuentan)
      { $match: { estado: 'pagado' } },
      // Etapa 2: $unwind "explota" el array items
      // Un doc con 3 items → 3 documentos, cada uno con un item
      { $unwind: '$items' },
      // Etapa 3: agrupar por platillo, sumar cantidades e ingresos
      {
        $group: {
          _id: '$items.menu_item_id',
          nombre: { $first: '$items.nombre' },       // tomamos el nombre del primer doc del grupo
          total_vendido: { $sum: '$items.cantidad' }, // sumamos todas las cantidades
          ingresos: { $sum: '$items.subtotal' }       // sumamos todos los subtotales
        }
      },
      // Etapa 4: ordenar por más vendido
      { $sort: { total_vendido: -1 } },
      // Etapa 5: solo los top 5
      { $limit: 5 },
      // Etapa 6: $lookup — equivalente a JOIN en SQL
      // Trae info adicional del platillo desde menu_items
      {
        $lookup: {
          from: 'menu_items',        // colección a unir
          localField: '_id',         // campo en el resultado actual
          foreignField: '_id',       // campo en menu_items
          as: 'info'                 // nombre del array resultante
        }
      },
      // Etapa 7: $project — seleccionar campos del resultado final
      {
        $project: {
          nombre: 1,
          total_vendido: 1,
          ingresos: 1,
          // $arrayElemAt extrae el primer elemento del array 'info'
          categoria: { $arrayElemAt: ['$info.categoria', 0] }
        }
      }
    ]).toArray();

    console.log('Top 5 platillos mas vendidos:');
    resultados.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.nombre} | vendidos: ${r.total_vendido} | ingresos: Q${r.ingresos} | categoria: ${r.categoria || 'N/A'}`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'pipeline top 5 platillos') || [];
  }
}

// =====================================================
// PIPELINE COMPLEJA 2: Restaurantes mejor calificados
// =====================================================

/**
 * restaurantesMejorCalificados() — ranking de restaurantes por calificación promedio.
 * Solo incluye restaurantes con al menos 5 reseñas (para que el promedio sea significativo).
 * Pipeline: $group → $match → $lookup → $unwind → $project → $sort → $limit
 *
 * @returns {Array} - Restaurantes con nombre, promedio y total de reseñas
 */
async function restaurantesMejorCalificados() {
  try {
    const db = getDb();
    const resultados = await db.collection('resenas').aggregate([
      // Etapa 1: agrupar reseñas por restaurante, calcular promedio
      {
        $group: {
          _id: '$restaurante_id',
          promedio: { $avg: '$calificacion' },  // promedio de calificaciones
          total: { $sum: 1 }                    // total de reseñas
        }
      },
      // Etapa 2: solo restaurantes con al menos 5 reseñas
      { $match: { total: { $gte: 5 } } },
      // Etapa 3: traer info del restaurante
      {
        $lookup: {
          from: 'restaurantes',
          localField: '_id',
          foreignField: '_id',
          as: 'rest'
        }
      },
      // Etapa 4: $unwind convierte el array 'rest' (siempre 1 elemento) en objeto
      { $unwind: '$rest' },
      // Etapa 5: seleccionar campos y redondear promedio
      {
        $project: {
          nombre: '$rest.nombre',
          // $round redondea a 1 decimal
          promedio: { $round: ['$promedio', 1] },
          total_resenas: '$total'
        }
      },
      // Etapa 6: mejor calificación primero
      { $sort: { promedio: -1 } },
      { $limit: 10 }
    ]).toArray();

    console.log('Restaurantes mejor calificados (min 5 resenas):');
    if (resultados.length === 0) {
      console.log('  No hay restaurantes con 5+ resenas aun');
    }
    resultados.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.nombre} | promedio: ${r.promedio}/5 | resenas: ${r.total_resenas}`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'pipeline restaurantes mejor calificados') || [];
  }
}

// =====================================================
// PIPELINE COMPLEJA 3: Ingresos por restaurante en un período
// =====================================================

/**
 * ingresosPorPeriodo(fechaInicio, fechaFin) — calcula ingresos de cada restaurante
 * en un rango de fechas, incluyendo ticket promedio y cantidad de órdenes.
 * Pipeline: $match → $group → $lookup → $project → $sort
 *
 * @param {string} fechaInicio - Fecha inicio en formato ISO (ej: '2026-01-01')
 * @param {string} fechaFin - Fecha fin en formato ISO (ej: '2026-04-01')
 * @returns {Array} - Restaurantes con ingresos, órdenes y ticket promedio
 */
async function ingresosPorPeriodo(fechaInicio, fechaFin) {
  try {
    const db = getDb();
    const resultados = await db.collection('ordenes').aggregate([
      // Etapa 1: filtrar solo órdenes pagadas en el rango de fechas
      {
        $match: {
          estado: 'pagado',
          created_at: {
            $gte: new Date(fechaInicio),  // mayor o igual a fecha inicio
            $lt: new Date(fechaFin)       // menor que fecha fin
          }
        }
      },
      // Etapa 2: agrupar por restaurante, calcular totales
      {
        $group: {
          _id: '$restaurante_id',
          ingresos: { $sum: '$total' },          // suma de todos los totales
          ordenes: { $sum: 1 },                  // cantidad de órdenes
          ticket_promedio: { $avg: '$total' }    // promedio del total por orden
        }
      },
      // Etapa 3: traer nombre del restaurante
      {
        $lookup: {
          from: 'restaurantes',
          localField: '_id',
          foreignField: '_id',
          as: 'rest'
        }
      },
      // Etapa 4: seleccionar campos finales
      {
        $project: {
          nombre: { $arrayElemAt: ['$rest.nombre', 0] },
          ingresos: 1,
          ordenes: 1,
          // Redondear ticket promedio a 2 decimales
          ticket_promedio: { $round: ['$ticket_promedio', 2] }
        }
      },
      // Etapa 5: más ingresos primero
      { $sort: { ingresos: -1 } }
    ]).toArray();

    console.log(`Ingresos por restaurante (${fechaInicio} a ${fechaFin}):`);
    if (resultados.length === 0) {
      console.log('  No hay ordenes pagadas en ese periodo');
    }
    resultados.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.nombre} | ingresos: Q${r.ingresos} | ordenes: ${r.ordenes} | ticket promedio: Q${r.ticket_promedio}`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'pipeline ingresos por periodo') || [];
  }
}

// =====================================================
// PIPELINE MAS SIMPLE: Total de ordenes por restaurante
// =====================================================

/**
 * totalOrdenesPorRestaurante() — cuenta cuántas órdenes tiene cada restaurante.
 * Pipeline de una sola etapa: $group
 * Es el pipeline más simple posible: agrupa todos los documentos por un campo
 * y cuenta cuántos hay en cada grupo.
 *
 * @returns {Array} - [{ _id: ObjectId, total: 25 }, ...]
 */
async function totalOrdenesPorRestaurante() {
  try {
    const db = getDb();
    const resultados = await db.collection('ordenes').aggregate([
      // Una sola etapa: $group agrupa por restaurante_id y cuenta
      { $group: { _id: '$restaurante_id', total: { $sum: 1 } } }
    ]).toArray();

    // Traemos los nombres de los restaurantes para mostrar en consola
    const restaurantes = await db.collection('restaurantes').find(
      { _id: { $in: resultados.map(r => r._id) } },
      { projection: { nombre: 1 } }
    ).toArray();
    const nombres = {};
    restaurantes.forEach(r => { nombres[r._id.toString()] = r.nombre; });

    console.log('Total de ordenes por restaurante (pipeline 1 etapa):');
    resultados.forEach(r => {
      const nombre = nombres[r._id.toString()] || 'Desconocido';
      console.log(`  ${nombre}: ${r.total} ordenes`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'pipeline total ordenes por restaurante') || [];
  }
}

module.exports = {
  totalOrdenesPorRestaurante,
  conteoOrdenesPorEstado,
  top5Platillos,
  restaurantesMejorCalificados,
  ingresosPorPeriodo
};
