const { getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');

/**
 * Operadores de arrays en MongoDB:
 *   $push    → agrega un elemento al final del array (permite duplicados)
 *   $pull    → elimina todos los elementos que coincidan con el valor dado
 *   $addToSet → agrega un elemento SOLO si no existe ya (evita duplicados)
 *
 * Son operaciones atómicas: no necesitamos leer el documento antes de modificarlo.
 * MongoDB se encarga de que no haya conflictos si dos operaciones ocurren al mismo tiempo.
 */

// =====================================================
// $push — agregar elemento al array (permite duplicados)
// =====================================================

/**
 * agregarItemAOrden(ordenId, nuevoItem) — agrega un item al array 'items' de una orden.
 * $push SIEMPRE agrega, incluso si ya existe un item idéntico.
 *
 * @param {ObjectId} ordenId - ID de la orden
 * @param {Object} nuevoItem - { menu_item_id, nombre, precio_unitario, cantidad, notas, subtotal }
 * @returns {Object|null} - Resultado del update
 */
async function agregarItemAOrden(ordenId, nuevoItem) {
  try {
    const db = getDb();
    // $push agrega el nuevoItem al final del array 'items'
    const result = await db.collection('ordenes').updateOne(
      { _id: ordenId },
      { $push: { items: nuevoItem } }
    );

    if (result.matchedCount === 0) {
      console.log('No se encontro la orden con ese _id');
    } else {
      console.log(`Item "${nuevoItem.nombre}" agregado a la orden | $push exitoso`);
    }
    return result;
  } catch (err) {
    return manejarError(err, 'agregar item a orden ($push)');
  }
}

/**
 * registrarCambioEstado(ordenId, nuevoEstado, usuarioId) — agrega al historial de estados.
 * $push añade un nuevo registro con estado, timestamp y quién hizo el cambio.
 *
 * @param {ObjectId} ordenId
 * @param {string} nuevoEstado - 'pendiente'|'en_preparacion'|'servido'|'pagado'|'cancelado'
 * @param {ObjectId} usuarioId - Quién hizo el cambio (trazabilidad)
 * @returns {Object|null}
 */
async function registrarCambioEstado(ordenId, nuevoEstado, usuarioId) {
  try {
    const db = getDb();
    const result = await db.collection('ordenes').updateOne(
      { _id: ordenId },
      {
        $push: {
          historial_estados: {
            estado: nuevoEstado,
            timestamp: new Date(),
            usuario_id: usuarioId
          }
        }
      }
    );

    if (result.matchedCount === 0) {
      console.log('No se encontro la orden con ese _id');
    } else {
      console.log(`Estado "${nuevoEstado}" registrado en historial | $push exitoso`);
    }
    return result;
  } catch (err) {
    return manejarError(err, 'registrar cambio de estado ($push)');
  }
}

// =====================================================
// $pull — eliminar elementos del array por valor
// =====================================================

/**
 * quitarTagRestaurante(restauranteId, tag) — elimina un tag del array 'tags'.
 * $pull elimina TODAS las ocurrencias del valor que coincida.
 *
 * @param {ObjectId} restauranteId
 * @param {string} tag - El tag a eliminar (ej: 'temporalmente_cerrado')
 * @returns {Object|null}
 */
async function quitarTagRestaurante(restauranteId, tag) {
  try {
    const db = getDb();
    // $pull busca y elimina el valor dentro del array 'tags'
    const result = await db.collection('restaurantes').updateOne(
      { _id: restauranteId },
      { $pull: { tags: tag } }
    );

    if (result.modifiedCount > 0) {
      console.log(`Tag "${tag}" eliminado del restaurante | $pull exitoso`);
    } else {
      console.log(`Tag "${tag}" no se encontro en el restaurante (puede que ya no existia)`);
    }
    return result;
  } catch (err) {
    return manejarError(err, 'quitar tag de restaurante ($pull)');
  }
}

// =====================================================
// $addToSet — agregar sin duplicados
// =====================================================

/**
 * agregarTagResena(resenaId, tag) — agrega un tag a la reseña SOLO si no existe.
 * $addToSet revisa si el valor ya está en el array antes de agregarlo.
 * Si ya existe, no hace nada (no genera error).
 *
 * @param {ObjectId} resenaId
 * @param {string} tag - El tag a agregar (ej: 'excelente_servicio')
 * @returns {Object|null}
 */
async function agregarTagResena(resenaId, tag) {
  try {
    const db = getDb();
    // $addToSet agrega SOLO si no existe ya en el array
    const result = await db.collection('resenas').updateOne(
      { _id: resenaId },
      { $addToSet: { tags: tag } }
    );

    if (result.modifiedCount > 0) {
      console.log(`Tag "${tag}" agregado a la resena | $addToSet exitoso (era nuevo)`);
    } else {
      console.log(`Tag "${tag}" ya existia en la resena | $addToSet no duplico`);
    }
    return result;
  } catch (err) {
    return manejarError(err, 'agregar tag a resena ($addToSet)');
  }
}

/**
 * agregarTagRestaurante(restauranteId, tag) — agrega un tag al restaurante sin duplicar.
 *
 * @param {ObjectId} restauranteId
 * @param {string} tag
 * @returns {Object|null}
 */
async function agregarTagRestaurante(restauranteId, tag) {
  try {
    const db = getDb();
    const result = await db.collection('restaurantes').updateOne(
      { _id: restauranteId },
      { $addToSet: { tags: tag } }
    );

    if (result.modifiedCount > 0) {
      console.log(`Tag "${tag}" agregado al restaurante | $addToSet exitoso`);
    } else {
      console.log(`Tag "${tag}" ya existia en el restaurante | $addToSet no duplico`);
    }
    return result;
  } catch (err) {
    return manejarError(err, 'agregar tag a restaurante ($addToSet)');
  }
}

module.exports = {
  agregarItemAOrden,
  registrarCambioEstado,
  quitarTagRestaurante,
  agregarTagResena,
  agregarTagRestaurante
};
