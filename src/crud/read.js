const { getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');

// =====================================================
// READ — Funciones para consultar documentos
// =====================================================

/**
 * restaurantesCercanos(lat, lng, distanciaMetros) — busca restaurantes cerca de una ubicación.
 * Usa $nearSphere con el índice 2dsphere para ordenar por distancia.
 * @param {number} lat - Latitud del punto de búsqueda
 * @param {number} lng - Longitud del punto de búsqueda
 * @param {number} distanciaMetros - Radio máximo en metros (default 5km)
 * @returns {Array} - Restaurantes ordenados por cercanía
 */
async function restaurantesCercanos(lat, lng, distanciaMetros = 5000) {
  try {
    const db = getDb();
    // $nearSphere usa el índice 2dsphere para encontrar docs por distancia
    // IMPORTANTE: coordinates van en orden [longitud, latitud], no al revés
    const resultados = await db.collection('restaurantes').find({
      activo: true,
      ubicacion: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: distanciaMetros  // distancia máxima en metros
        }
      }
    }).toArray();

    console.log(`Restaurantes cercanos encontrados: ${resultados.length} (radio: ${distanciaMetros}m)`);
    resultados.forEach(r => {
      console.log(`  - ${r.nombre} | ${r.categoria} | ${r.direccion}`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'buscar restaurantes cercanos') || [];
  }
}

/**
 * menuPorCategoria(restauranteId, categoria) — consulta el menú con projection.
 * Solo trae nombre, precio y categoría (sin _id, ingredientes, etc.)
 * para optimizar el tráfico entre MongoDB y el backend.
 * @param {ObjectId} restauranteId
 * @param {string} categoria - 'entrada', 'plato_fuerte', 'postre', 'bebida'
 * @returns {Array}
 */
async function menuPorCategoria(restauranteId, categoria) {
  try {
    const db = getDb();
    // Si categoria es 'todo' o vacío, no filtrar por categoria
    const filtro = (categoria && categoria !== 'todo')
      ? { restaurante_id: restauranteId, categoria, disponible: true }
      : { restaurante_id: restauranteId, disponible: true };

    const resultados = await db.collection('menu_items').find(
      filtro,
      // Projection de inclusión: solo traer estos 3 campos, excluir _id
      { projection: { nombre: 1, precio: 1, categoria: 1, _id: 0 } }
    ).sort({ categoria: 1, precio: 1 }).toArray();  // ordenar por categoria y precio

    const label = (categoria && categoria !== 'todo') ? categoria : 'todo';
    console.log(`Menu "${label}" (${resultados.length} items):`);
    resultados.forEach(r => {
      console.log(`  - [${r.categoria}] ${r.nombre}: Q${r.precio}`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'consultar menu por categoria') || [];
  }
}

/**
 * ordenesPorRestaurante(restauranteId, pagina, limite) — lista órdenes con paginación.
 * Usa skip + limit para paginar y projection para no traer el array de items.
 * @param {ObjectId} restauranteId
 * @param {number} pagina - Número de página (1, 2, 3...)
 * @param {number} limite - Documentos por página (default 20)
 * @returns {Array}
 */
async function ordenesPorRestaurante(restauranteId, pagina = 1, limite = 20) {
  try {
    const db = getDb();
    // skip calcula cuántos documentos saltar según la página
    // Página 1 = skip(0), Página 2 = skip(20), Página 3 = skip(40)...
    const skip = (pagina - 1) * limite;

    const resultados = await db.collection('ordenes').find(
      { restaurante_id: restauranteId },
      // Projection: NO traemos el array de items (puede ser grande)
      { projection: { numero_mesa: 1, estado: 1, total: 1, created_at: 1 } }
    ).sort({ created_at: -1 })  // más recientes primero
      .skip(skip)
      .limit(limite)
      .toArray();

    console.log(`Ordenes del restaurante (pagina ${pagina}, ${resultados.length} resultados):`);
    resultados.forEach(r => {
      console.log(`  - Mesa ${r.numero_mesa} | ${r.estado} | Q${r.total} | ${r.created_at.toLocaleDateString()}`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'consultar ordenes por restaurante') || [];
  }
}

/**
 * buscarPlatillos(textoBusqueda) — búsqueda full-text en nombre y descripción.
 * Usa el índice de texto creado en menu_items.
 * Los resultados se ordenan por relevancia (textScore).
 * @param {string} textoBusqueda - Texto a buscar (ej: "pepián", "pollo crema")
 * @returns {Array}
 */
async function buscarPlatillos(textoBusqueda) {
  try {
    const db = getDb();
    const resultados = await db.collection('menu_items').find(
      // $text busca en todos los campos del índice de texto
      { $text: { $search: textoBusqueda } },
      // $meta: 'textScore' devuelve la relevancia del resultado
      { projection: { nombre: 1, precio: 1, score: { $meta: 'textScore' } } }
    ).sort({ score: { $meta: 'textScore' } })  // más relevantes primero
      .toArray();

    console.log(`Busqueda "${textoBusqueda}" (${resultados.length} resultados):`);
    resultados.forEach(r => {
      console.log(`  - ${r.nombre}: Q${r.precio} (relevancia: ${r.score.toFixed(2)})`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'buscar platillos por texto') || [];
  }
}

/**
 * lookupOrdenesConDetalle(restauranteId) — lookup multi-colección.
 * Usa $lookup para unir órdenes con info del cliente y del restaurante.
 * Equivalente a un JOIN en SQL.
 * @param {ObjectId} restauranteId
 * @returns {Array}
 */
async function lookupOrdenesConDetalle(restauranteId) {
  try {
    const db = getDb();
    const resultados = await db.collection('ordenes').aggregate([
      { $match: { restaurante_id: restauranteId } },
      { $limit: 5 },
      // $lookup une con la colección usuarios para traer info del cliente
      {
        $lookup: {
          from: 'usuarios',
          localField: 'usuario_id',
          foreignField: '_id',
          as: 'cliente'
        }
      },
      // $lookup une con restaurantes para traer el nombre
      {
        $lookup: {
          from: 'restaurantes',
          localField: 'restaurante_id',
          foreignField: '_id',
          as: 'restaurante'
        }
      },
      {
        $project: {
          numero_mesa: 1,
          estado: 1,
          total: 1,
          // $arrayElemAt extrae el primer elemento del array de lookup
          cliente_nombre: { $arrayElemAt: ['$cliente.nombre', 0] },
          restaurante_nombre: { $arrayElemAt: ['$restaurante.nombre', 0] }
        }
      }
    ]).toArray();

    console.log(`Lookup ordenes con detalle (${resultados.length} resultados):`);
    resultados.forEach(r => {
      console.log(`  - ${r.restaurante_nombre} | Mesa ${r.numero_mesa} | ${r.estado} | Q${r.total} | Cliente: ${r.cliente_nombre}`);
    });
    return resultados;
  } catch (err) {
    return manejarError(err, 'lookup ordenes con detalle') || [];
  }
}

module.exports = {
  restaurantesCercanos,
  menuPorCategoria,
  ordenesPorRestaurante,
  buscarPlatillos,
  lookupOrdenesConDetalle
};
