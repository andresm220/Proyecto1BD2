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

module.exports = {
  actualizarEstadoOrden,
  deshabilitarCategoriaMenu,
  actualizarPrecioMenuItem,
  responderResena
};
