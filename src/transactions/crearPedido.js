const { getDb, getClient } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');

/**
 * crearPedidoAtomico(restauranteId, clienteId, meseroId, numeroMesa, items)
 *
 * Transacción que realiza 2 operaciones de forma atómica:
 *   1. Inserta la orden en la colección 'ordenes'
 *   2. Marca la mesa como ocupada en el restaurante (mesas.$.disponible = false)
 *
 * Si cualquiera de las dos falla, se hace rollback y ningún cambio se guarda.
 * Esto evita que quede una orden sin mesa ocupada, o una mesa ocupada sin orden.
 *
 * @param {ObjectId} restauranteId - ID del restaurante
 * @param {ObjectId} clienteId - ID del cliente que hace el pedido
 * @param {ObjectId} meseroId - ID del mesero que atiende
 * @param {number} numeroMesa - Número de la mesa a ocupar
 * @param {Array} itemsCarrito - [{ _id, nombre, precio, cantidad, notas? }]
 * @returns {ObjectId|null} - ID de la orden creada, o null si falla
 */
async function crearPedidoAtomico(restauranteId, clienteId, meseroId, numeroMesa, itemsCarrito) {
  const client = getClient();
  const db = getDb();
  // startSession() crea una sesión necesaria para manejar la transacción
  const session = client.startSession();

  try {
    // Iniciamos la transacción — desde aquí, todo es "todo o nada"
    session.startTransaction();

    // --- Paso 1: Construir y guardar la orden ---
    // Creamos el snapshot de los items (copiamos nombre y precio actuales)
    const items = itemsCarrito.map(item => ({
      menu_item_id: item._id,
      nombre: item.nombre,
      precio_unitario: item.precio,
      cantidad: item.cantidad,
      notas: item.notas || '',
      subtotal: item.precio * item.cantidad
    }));
    const total = items.reduce((sum, i) => sum + i.subtotal, 0);

    const orden = {
      restaurante_id: restauranteId,
      usuario_id: clienteId,
      mesero_id: meseroId,
      numero_mesa: numeroMesa,
      estado: 'pendiente',
      items,
      total,
      metodo_pago: null,
      historial_estados: [{ estado: 'pendiente', timestamp: new Date() }],
      comprobante_pdf_id: null,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Insertamos la orden — { session } la une a la transacción
    const result = await db.collection('ordenes').insertOne(orden, { session });

    // --- Paso 2: Marcar la mesa como ocupada ---
    // 'mesas.numero': numeroMesa filtra el elemento del array
    // 'mesas.$.disponible' usa el operador posicional $ para apuntar al elemento encontrado
    const updateMesa = await db.collection('restaurantes').updateOne(
      { _id: restauranteId, 'mesas.numero': numeroMesa },
      { $set: { 'mesas.$.disponible': false } },
      { session }
    );

    // Verificamos que la mesa se haya encontrado y actualizado
    if (updateMesa.matchedCount === 0) {
      throw new Error(`No se encontro la mesa ${numeroMesa} en el restaurante`);
    }

    // commitTransaction() confirma ambos cambios de forma permanente
    await session.commitTransaction();
    console.log('Pedido creado y mesa ocupada correctamente');
    console.log(`  Orden _id: ${result.insertedId} | Mesa: ${numeroMesa} | Total: Q${total}`);
    return result.insertedId;

  } catch (err) {
    // abortTransaction() revierte TODOS los cambios si algo falla
    await session.abortTransaction();
    manejarError(err, 'crear pedido atomico (transaccion revertida)');
    return null;
  } finally {
    // endSession() siempre se ejecuta, haya éxito o error
    session.endSession();
  }
}

module.exports = { crearPedidoAtomico };
