const { getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');

// =====================================================
// DELETE — Funciones para eliminar documentos
// =====================================================

/**
 * eliminarMenuItem(menuItemId) — elimina un artículo del menú.
 * Usa deleteOne para eliminar solo el documento con ese _id.
 * @param {ObjectId} menuItemId
 * @returns {Object|null} - Resultado con deletedCount
 */
async function eliminarMenuItem(menuItemId) {
  try {
    const db = getDb();
    // deleteOne elimina SOLO el documento que coincida con el filtro
    const result = await db.collection('menu_items').deleteOne({ _id: menuItemId });

    if (result.deletedCount === 0) {
      console.log('No se encontro el item del menu para eliminar');
    } else {
      console.log('Item del menu eliminado correctamente');
    }
    return result;
  } catch (err) {
    return manejarError(err, 'eliminar item del menu');
  }
}

/**
 * eliminarResenasUsuario(usuarioId) — elimina TODAS las reseñas de un usuario.
 * Se usa cuando un usuario se da de baja del sistema.
 * Usa deleteMany para eliminar múltiples documentos a la vez.
 * @param {ObjectId} usuarioId
 * @returns {Object|null} - Resultado con deletedCount
 */
async function eliminarResenasUsuario(usuarioId) {
  try {
    const db = getDb();
    // deleteMany elimina TODOS los documentos que coincidan con el filtro
    const result = await db.collection('resenas').deleteMany({ usuario_id: usuarioId });
    console.log(`Resenas eliminadas del usuario: ${result.deletedCount}`);
    return result;
  } catch (err) {
    return manejarError(err, 'eliminar resenas del usuario');
  }
}

/**
 * cancelarOrden(ordenId) — cancela una orden y elimina su comprobante PDF de GridFS.
 * Primero actualiza el estado a 'cancelado', luego elimina el PDF si existe.
 * @param {ObjectId} ordenId
 * @returns {Object|null}
 */
async function cancelarOrden(ordenId) {
  try {
    const db = getDb();
    const { GridFSBucket } = require('mongodb');

    // Buscamos la orden para ver si tiene comprobante PDF
    const orden = await db.collection('ordenes').findOne({ _id: ordenId });
    if (!orden) {
      console.log('No se encontro la orden para cancelar');
      return null;
    }

    // Si la orden tiene un PDF en GridFS, lo eliminamos
    if (orden.comprobante_pdf_id) {
      const bucket = new GridFSBucket(db, { bucketName: 'comprobantes' });
      await bucket.delete(orden.comprobante_pdf_id);
      console.log('Comprobante PDF eliminado de GridFS');
    }

    // Eliminamos la orden de la colección
    const result = await db.collection('ordenes').deleteOne({ _id: ordenId });
    console.log('Orden cancelada y eliminada correctamente');
    return result;
  } catch (err) {
    return manejarError(err, 'cancelar orden');
  }
}

module.exports = { eliminarMenuItem, eliminarResenasUsuario, cancelarOrden };
