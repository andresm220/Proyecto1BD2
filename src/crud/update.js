const { getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');

// =====================================================
// UPDATE — Funciones para actualizar documentos
// =====================================================

/**
 * actualizarEstadoOrden(ordenId, nuevoEstado, meseroId) — actualiza el estado de una orden.
 * Usa $set para cambiar el estado y $push para agregar al historial embebido.
 * Ambos operadores van en el mismo updateOne = una sola operación atómica.
 * @param {ObjectId} ordenId
 * @param {string} nuevoEstado - 'pendiente'|'en_preparacion'|'servido'|'pagado'|'cancelado'
 * @param {ObjectId} meseroId - Quién hizo el cambio (trazabilidad)
 * @returns {Object|null} - Resultado del update
 */
async function actualizarEstadoOrden(ordenId, nuevoEstado, meseroId) {
  try {
    const db = getDb();
    const result = await db.collection('ordenes').updateOne(
      { _id: ordenId },
      {
        // $set cambia campos específicos del documento
        $set: { estado: nuevoEstado, updated_at: new Date() },
        // $push agrega un nuevo elemento al final del array historial_estados
        $push: {
          historial_estados: {
            estado: nuevoEstado,
            timestamp: new Date(),
            usuario_id: meseroId
          }
        }
      }
    );

    if (result.matchedCount === 0) {
      console.log('No se encontro la orden con ese _id');
    } else {
      console.log(`Orden actualizada a "${nuevoEstado}" | Documentos modificados: ${result.modifiedCount}`);
    }
    return result;
  } catch (err) {
    return manejarError(err, 'actualizar estado de orden');
  }
}

/**
 * deshabilitarCategoriaMenu(restauranteId, categoria) — marca como no disponibles
 * TODOS los artículos de una categoría de un restaurante.
 * Usa updateMany para afectar múltiples documentos a la vez.
 * @param {ObjectId} restauranteId
 * @param {string} categoria - 'entrada'|'plato_fuerte'|'postre'|'bebida'
 * @returns {Object|null}
 */
async function deshabilitarCategoriaMenu(restauranteId, categoria) {
  try {
    const db = getDb();
    // updateMany aplica el cambio a TODOS los documentos que coincidan
    const result = await db.collection('menu_items').updateMany(
      { restaurante_id: restauranteId, categoria },
      { $set: { disponible: false } }
    );

    console.log(`Categoria "${categoria}" deshabilitada | Items afectados: ${result.modifiedCount}`);
    return result;
  } catch (err) {
    return manejarError(err, 'deshabilitar categoria del menu');
  }
}

/**
 * actualizarPrecioMenuItem(menuItemId, nuevoPrecio) — actualiza el precio de un platillo.
 * Solo cambia el precio en el menú; las órdenes existentes NO se afectan
 * porque usan snapshot (copia del precio al momento del pedido).
 * @param {ObjectId} menuItemId
 * @param {number} nuevoPrecio
 * @returns {Object|null}
 */
async function actualizarPrecioMenuItem(menuItemId, nuevoPrecio) {
  try {
    const db = getDb();
    const result = await db.collection('menu_items').updateOne(
      { _id: menuItemId },
      { $set: { precio: nuevoPrecio } }
    );

    if (result.matchedCount === 0) {
      console.log('No se encontro el item del menu con ese _id');
    } else {
      console.log(`Precio actualizado a Q${nuevoPrecio} | Modificados: ${result.modifiedCount}`);
    }
    return result;
  } catch (err) {
    return manejarError(err, 'actualizar precio del menu');
  }
}

/**
 * responderResena(resenaId, textoRespuesta) — agrega la respuesta del restaurante.
 * Actualiza el campo embebido respuesta_restaurante dentro de la reseña.
 * @param {ObjectId} resenaId
 * @param {string} textoRespuesta
 * @returns {Object|null}
 */
async function responderResena(resenaId, textoRespuesta) {
  try {
    const db = getDb();
    const result = await db.collection('resenas').updateOne(
      { _id: resenaId },
      {
        $set: {
          // Actualizamos el subdocumento embebido completo
          respuesta_restaurante: {
            texto: textoRespuesta,
            fecha: new Date()
          }
        }
      }
    );

    if (result.matchedCount === 0) {
      console.log('No se encontro la resena con ese _id');
    } else {
      console.log('Respuesta agregada a la resena | Modificados:', result.modifiedCount);
    }
    return result;
  } catch (err) {
    return manejarError(err, 'responder resena');
  }
}

/**
 * bulkActualizarDisponibilidadMenu(cambios) — actualiza la disponibilidad de varios
 * platillos en UNA SOLA operacion de red usando bulkWrite().
 *
 * Diferencia clave con updateMany:
 *   - updateMany aplica el MISMO cambio a todos los documentos que coincidan.
 *   - bulkWrite permite operaciones DISTINTAS por documento en una sola llamada.
 *
 * Caso de uso: el admin habilita algunos platillos y deshabilita otros al mismo tiempo
 * (por ejemplo, al cambiar el menu del dia) sin hacer multiples roundtrips a MongoDB.
 *
 * @param {Array} cambios - [{ menuItemId: ObjectId, disponible: boolean }]
 *   Cada elemento define una operacion updateOne independiente.
 * @returns {Object|null} - Resultado del bulkWrite con matchedCount y modifiedCount
 */
async function bulkActualizarDisponibilidadMenu(cambios) {
  try {
    const db = getDb();

    // Construimos una operacion updateOne por cada cambio
    // Cada una puede tener un valor de 'disponible' distinto
    const operaciones = cambios.map(c => ({
      updateOne: {
        filter: { _id: c.menuItemId },
        update: { $set: { disponible: c.disponible, updated_at: new Date() } }
      }
    }));

    // bulkWrite envia todas las operaciones en un solo mensaje al servidor
    const result = await db.collection('menu_items').bulkWrite(operaciones);

    console.log(`bulkWrite completado | ${operaciones.length} operaciones enviadas`);
    console.log(`  Encontrados: ${result.matchedCount} | Modificados: ${result.modifiedCount}`);
    return result;
  } catch (err) {
    return manejarError(err, 'bulk actualizar disponibilidad menu (bulkWrite)');
  }
}

module.exports = {
  actualizarEstadoOrden,
  deshabilitarCategoriaMenu,
  actualizarPrecioMenuItem,
  responderResena,
  bulkActualizarDisponibilidadMenu
};
