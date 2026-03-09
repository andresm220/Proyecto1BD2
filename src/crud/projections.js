const { getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');

/**
 * Projections en MongoDB controlan qué campos se retornan en una consulta.
 * Reducen el tráfico de red entre la base de datos y el backend.
 *
 * Dos tipos:
 *   Inclusión { campo: 1 } → solo trae los campos indicados
 *   Exclusión { campo: 0 } → trae todo MENOS los campos indicados
 *
 * Regla: NO se pueden mezclar inclusión y exclusión en la misma projection,
 * EXCEPTO con _id (se puede hacer { nombre: 1, _id: 0 }).
 */

// =====================================================
// 1. INCLUSION SIMPLE — solo nombre, precio y categoría
// =====================================================

/**
 * projectionMenuSimple(restauranteId) — trae solo nombre, precio y categoría.
 * Excluye: _id, ingredientes, tiempo_preparacion_min, restaurante_id, descripcion, etc.
 * Es la projection más básica: { campo: 1 } = incluir, { _id: 0 } = excluir el _id.
 *
 * @param {ObjectId} restauranteId
 * @returns {Array} - [{ nombre, precio, categoria }]
 */
async function projectionMenuSimple(restauranteId) {
  try {
    const db = getDb();
    const resultados = await db.collection('menu_items').find(
      // Filtro: platillos disponibles de este restaurante
      { restaurante_id: restauranteId, disponible: true },
      // Projection de inclusión: solo estos 3 campos, sin _id
      { projection: { nombre: 1, precio: 1, categoria: 1, _id: 0 } }
    ).sort({ precio: 1 }).toArray();

    console.log(`Projection INCLUSION simple (${resultados.length} items):`);
    console.log('  Campos retornados: nombre, precio, categoria (sin _id)');
    resultados.forEach(r => {
      // Mostramos las keys para probar que SOLO vienen los campos pedidos
      console.log(`  - ${r.nombre}: Q${r.precio} | ${r.categoria} | keys: [${Object.keys(r).join(', ')}]`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'projection menu simple') || [];
  }
}

// =====================================================
// 2. INCLUSION + PAGINACION — órdenes sin el array de items
// =====================================================

/**
 * projectionOrdenesSinItems(restauranteId, pagina, limite) — lista órdenes ligeras.
 * El array 'items' puede ser grande (muchos platillos con detalles).
 * En un listado no lo necesitamos, así que lo excluimos con projection.
 * Combina projection con sort + skip + limit para paginación.
 *
 * @param {ObjectId} restauranteId
 * @param {number} pagina - Número de página (1, 2, 3...)
 * @param {number} limite - Documentos por página
 * @returns {Array} - [{ numero_mesa, estado, total, created_at }]
 */
async function projectionOrdenesSinItems(restauranteId, pagina = 1, limite = 20) {
  try {
    const db = getDb();
    const skip = (pagina - 1) * limite;

    const resultados = await db.collection('ordenes').find(
      { restaurante_id: restauranteId },
      // Projection: incluimos solo los campos del listado
      // El array items y historial_estados NO se traen
      { projection: { numero_mesa: 1, estado: 1, total: 1, created_at: 1 } }
    )
      .sort({ created_at: -1 })  // más recientes primero
      .skip(skip)                 // saltar documentos de páginas anteriores
      .limit(limite)              // traer solo 'limite' documentos
      .toArray();

    console.log(`Projection INCLUSION + paginacion (pagina ${pagina}, ${resultados.length} resultados):`);
    console.log('  Campos retornados: _id, numero_mesa, estado, total, created_at (SIN items)');
    resultados.forEach(r => {
      console.log(`  - Mesa ${r.numero_mesa} | ${r.estado} | Q${r.total} | keys: [${Object.keys(r).join(', ')}]`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'projection ordenes sin items') || [];
  }
}

// =====================================================
// 3. EXCLUSION — perfil de usuario sin password_hash
// =====================================================

/**
 * projectionUsuarioSinPassword(filtro) — trae el perfil del usuario sin exponer el hash.
 * Projection de exclusión: { campo: 0 } trae TODO menos ese campo.
 * El frontend NUNCA debe recibir el hash de la contraseña.
 *
 * @param {Object} filtro - Filtro de búsqueda (ej: { rol: 'cliente' })
 * @returns {Array} - Usuarios sin el campo password_hash
 */
async function projectionUsuarioSinPassword(filtro = {}) {
  try {
    const db = getDb();
    const resultados = await db.collection('usuarios').find(
      filtro,
      // Projection de exclusión: trae TODOS los campos MENOS password_hash
      { projection: { password_hash: 0 } }
    ).limit(5).toArray();

    console.log(`Projection EXCLUSION (${resultados.length} usuarios):`);
    console.log('  Campos excluidos: password_hash');
    resultados.forEach(r => {
      const tienePassword = r.password_hash !== undefined;
      console.log(`  - ${r.nombre} | ${r.rol} | tiene password_hash: ${tienePassword ? 'SI (ERROR!)' : 'NO (correcto)'} | keys: [${Object.keys(r).join(', ')}]`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'projection usuario sin password') || [];
  }
}

module.exports = {
  projectionMenuSimple,
  projectionOrdenesSinItems,
  projectionUsuarioSinPassword
};
