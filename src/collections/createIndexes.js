const { conectar, getDb } = require('../db/connection');

/**
 * crearIndices() — crea los 9 índices definidos en el documento de diseño.
 * Los índices aceleran las consultas: en lugar de revisar cada documento,
 * MongoDB va directo a los resultados usando el índice (como el índice de un libro).
 *
 * Tipos de índice usados:
 * - Único simple: garantiza que no haya duplicados (email)
 * - Simple: acelera filtros por un solo campo (estado)
 * - Compuesto: combina dos campos para queries que filtran por ambos
 * - Multikey: indexa cada elemento de un array por separado (tags)
 * - Geoespacial 2dsphere: permite buscar por ubicación geográfica
 * - Texto: permite búsqueda full-text en campos de texto
 */
async function crearIndices() {
  const db = getDb();

  console.log('\nCreando indices...\n');

  // =====================================================
  // 1. UNICO SIMPLE — usuarios.email
  // Garantiza que no existan dos usuarios con el mismo email.
  // Tambien acelera el login (buscar usuario por email).
  // { unique: true } hace que MongoDB rechace inserciones duplicadas.
  // =====================================================
  await db.collection('usuarios').createIndex(
    { email: 1 },
    { unique: true }
  );
  console.log('1/9 - Indice UNICO en usuarios.email');

  // =====================================================
  // 2. SIMPLE — ordenes.estado
  // Acelera queries como: "dame todas las ordenes pendientes"
  // Sin este índice, MongoDB revisaría TODAS las ordenes.
  // =====================================================
  await db.collection('ordenes').createIndex({ estado: 1 });
  console.log('2/9 - Indice SIMPLE en ordenes.estado');

  // =====================================================
  // 3. COMPUESTO — ordenes.restaurante_id + created_at
  // Sirve para: "ordenes del restaurante X ordenadas por fecha"
  // restaurante_id va primero porque es más selectivo (filtra más).
  // created_at: -1 ordena de más reciente a más antiguo.
  // =====================================================
  await db.collection('ordenes').createIndex(
    { restaurante_id: 1, created_at: -1 }
  );
  console.log('3/9 - Indice COMPUESTO en ordenes {restaurante_id, created_at}');

  // =====================================================
  // 4. COMPUESTO — menu_items.restaurante_id + categoria
  // Sirve para: "platillos del restaurante X en categoría Y"
  // Ambos campos se usan juntos en la consulta de menú.
  // =====================================================
  await db.collection('menu_items').createIndex(
    { restaurante_id: 1, categoria: 1 }
  );
  console.log('4/9 - Indice COMPUESTO en menu_items {restaurante_id, categoria}');

  // =====================================================
  // 5. MULTIKEY — restaurantes.tags
  // MongoDB indexa CADA elemento del array por separado.
  // Si tags = ['familiar', 'wifi'], crea 2 entradas en el índice.
  // Sirve para: "restaurantes con tag 'terraza'"
  // =====================================================
  await db.collection('restaurantes').createIndex({ tags: 1 });
  console.log('5/9 - Indice MULTIKEY en restaurantes.tags');

  // =====================================================
  // 6. MULTIKEY — resenas.tags
  // Mismo concepto: indexa cada tag de las reseñas.
  // Sirve para: "reseñas etiquetadas como 'sabroso'"
  // =====================================================
  await db.collection('resenas').createIndex({ tags: 1 });
  console.log('6/9 - Indice MULTIKEY en resenas.tags');

  // =====================================================
  // 7. GEOESPACIAL 2dsphere — restaurantes.ubicacion
  // Necesario para usar $nearSphere y $geoWithin.
  // Permite buscar restaurantes cercanos a una coordenada.
  // El campo 'ubicacion' debe ser GeoJSON Point {type, coordinates}.
  // =====================================================
  await db.collection('restaurantes').createIndex({ ubicacion: '2dsphere' });
  console.log('7/9 - Indice GEOESPACIAL 2dsphere en restaurantes.ubicacion');

  // =====================================================
  // 8. TEXTO — menu_items.nombre + descripcion
  // Permite búsqueda full-text: buscar "pepián" encuentra
  // documentos donde nombre O descripción contengan esa palabra.
  // MongoDB solo permite UN índice de texto por colección.
  // =====================================================
  await db.collection('menu_items').createIndex(
    { nombre: 'text', descripcion: 'text' }
  );
  console.log('8/9 - Indice TEXTO en menu_items {nombre, descripcion}');

  // =====================================================
  // 9. TEXTO — resenas.comentario
  // Permite buscar palabras dentro de los comentarios de reseñas.
  // Ejemplo: buscar "excelente" en todos los comentarios.
  // =====================================================
  await db.collection('resenas').createIndex({ comentario: 'text' });
  console.log('9/9 - Indice TEXTO en resenas.comentario');

  console.log('\n=== 9 indices creados correctamente ===');
}

/**
 * validarIndices() — verifica que los índices se crearon correctamente
 * listando los índices de cada colección.
 */
async function validarIndices() {
  const db = getDb();
  const colecciones = ['usuarios', 'ordenes', 'menu_items', 'restaurantes', 'resenas'];

  console.log('\n--- Verificacion de indices por coleccion ---\n');
  for (const col of colecciones) {
    const indices = await db.collection(col).indexes();
    console.log(`${col} (${indices.length} indices):`);
    indices.forEach(idx => {
      // Mostramos el nombre del índice y los campos que cubre
      const campos = Object.entries(idx.key).map(([k, v]) => `${k}:${v}`).join(', ');
      const extra = idx.unique ? ' [UNICO]' : '';
      console.log(`  - ${campos}${extra}`);
    });
    console.log('');
  }
}

module.exports = { crearIndices, validarIndices };

// Ejecutar directamente si se llama con: node src/collections/createIndexes.js
if (require.main === module) {
  (async () => {
    const { client } = await conectar();
    await crearIndices();
    await validarIndices();
    await client.close();
  })().catch(console.error);
}
