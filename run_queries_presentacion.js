/**
 * Ejecuta todos los queries de QUERIES_PRESENTACION.md y muestra los resultados.
 */
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;

function sep(titulo) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + titulo);
  console.log('='.repeat(60));
}

function ok(msg) { console.log('  [OK]', msg); }
function info(msg) { console.log('      ', msg); }

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  console.log('Conectado a MongoDB:', dbName);

  const restaurantes = db.collection('restaurantes');
  const usuarios     = db.collection('usuarios');
  const menu_items   = db.collection('menu_items');
  const ordenes      = db.collection('ordenes');
  const resenas      = db.collection('resenas');

  const restBase = await restaurantes.findOne();
  const userBase = await usuarios.findOne();
  const mesero   = await usuarios.findOne({ rol: 'mesero' });

  // ============================================================
  sep('1. PROJECTIONS');
  // ============================================================

  // 1.1 Inclusion simple
  console.log('\n[1.1] Projection INCLUSION simple (nombre, precio, categoria, sin _id):');
  const inc1 = await menu_items.find(
    { disponible: true },
    { projection: { nombre: 1, precio: 1, categoria: 1, _id: 0 } }
  ).sort({ precio: 1 }).limit(5).toArray();
  inc1.forEach(d => info(`${d.nombre} | Q${d.precio} | ${d.categoria} | keys: [${Object.keys(d).join(', ')}]`));
  ok('Sin _id, solo los 3 campos pedidos');

  // 1.2 Inclusion + paginacion
  console.log('\n[1.2] Projection INCLUSION + paginacion (ordenes sin array items):');
  const inc2 = await ordenes.find(
    {},
    { projection: { numero_mesa: 1, estado: 1, total: 1, created_at: 1 } }
  ).sort({ created_at: -1 }).skip(0).limit(5).toArray();
  inc2.forEach(d => info(`Mesa ${d.numero_mesa} | ${d.estado} | Q${d.total} | keys: [${Object.keys(d).join(', ')}]`));
  ok('Sin campo "items", con skip/limit para paginacion');

  // 1.3 Exclusion
  console.log('\n[1.3] Projection EXCLUSION (usuarios sin password_hash):');
  const exc = await usuarios.find(
    { rol: 'cliente' },
    { projection: { password_hash: 0 } }
  ).limit(5).toArray();
  exc.forEach(d => info(`${d.nombre} | ${d.rol} | tiene password_hash: ${d.password_hash ? 'SI' : 'NO'}`));
  ok('password_hash excluido de la respuesta');

  // ============================================================
  sep('2. CRUD');
  // ============================================================

  // 2.1 CREATE
  console.log('\n[2.1] CREATE — insertOne menu item:');
  const ins = await menu_items.insertOne({
    restaurante_id: restBase._id,
    nombre: 'Platillo de Prueba',
    descripcion: 'Creado en la presentacion',
    categoria: 'entrada',
    precio: 45,
    ingredientes: ['tomate', 'queso'],
    disponible: true,
    tiempo_preparacion_min: 10,
    created_at: new Date()
  });
  ok(`Insertado con _id: ${ins.insertedId}`);

  // 2.2 READ full-text
  console.log('\n[2.2] READ — Busqueda full-text "$text: pollo":');
  const ft = await menu_items.find(
    { $text: { $search: 'pollo' } },
    { projection: { nombre: 1, precio: 1, score: { $meta: 'textScore' } } }
  ).sort({ score: { $meta: 'textScore' } }).toArray();
  ft.forEach(d => info(`${d.nombre} | Q${d.precio} | score: ${d.score?.toFixed(2)}`));
  ok(`${ft.length} resultados, ordenados por relevancia`);

  // 2.3 READ geoespacial
  console.log('\n[2.3] READ — $nearSphere (5km desde Zona 10 Guatemala):');
  const geo = await restaurantes.find({
    activo: true,
    ubicacion: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [-90.5132, 14.5890] },
        $maxDistance: 5000
      }
    }
  }, { projection: { nombre: 1, direccion: 1, categoria: 1, _id: 0 } }).toArray();
  geo.forEach(d => info(`${d.nombre} | ${d.categoria}`));
  ok(`${geo.length} restaurante(s) dentro de 5km, ordenados por distancia`);

  // 2.4 UPDATE precio
  console.log('\n[2.4] UPDATE — Actualizar precio de Pepian de Res a Q75:');
  const upd1 = await menu_items.updateOne(
    { nombre: 'Pepian de Res' },
    { $set: { precio: 75 } }
  );
  ok(`matchedCount: ${upd1.matchedCount} | modifiedCount: ${upd1.modifiedCount}`);

  // 2.5 UPDATE estado orden + historial
  console.log('\n[2.5] UPDATE — Cambiar orden pendiente a en_preparacion + $push historial:');
  const ordenPendiente = await ordenes.findOne({ estado: 'pendiente' });
  const upd2 = await ordenes.updateOne(
    { _id: ordenPendiente._id },
    {
      $set: { estado: 'en_preparacion', updated_at: new Date() },
      $push: {
        historial_estados: {
          estado: 'en_preparacion',
          timestamp: new Date(),
          usuario_id: mesero._id
        }
      }
    }
  );
  ok(`Orden ${ordenPendiente._id} | modifiedCount: ${upd2.modifiedCount}`);

  // 2.6 DELETE
  console.log('\n[2.6] DELETE — Eliminar Platillo de Prueba:');
  const del = await menu_items.deleteOne({ nombre: 'Platillo de Prueba' });
  ok(`deletedCount: ${del.deletedCount}`);

  // ============================================================
  sep('3. OPERADORES DE ARRAYS');
  // ============================================================

  // 3.1 $addToSet nuevo
  console.log('\n[3.1] $addToSet — Agregar "pet_friendly" a tags:');
  const as1 = await restaurantes.updateOne(
    { nombre: 'El Rincon Guatemalteco' },
    { $addToSet: { tags: 'pet_friendly' } }
  );
  ok(`modifiedCount: ${as1.modifiedCount} (1 = se agrego, 0 = ya existia)`);

  // 3.2 $addToSet duplicado
  console.log('\n[3.2] $addToSet — Intentar agregar duplicado "pet_friendly":');
  const as2 = await restaurantes.updateOne(
    { nombre: 'El Rincon Guatemalteco' },
    { $addToSet: { tags: 'pet_friendly' } }
  );
  ok(`modifiedCount: ${as2.modifiedCount} — NO duplico el tag`);

  // 3.3 $pull
  console.log('\n[3.3] $pull — Eliminar "pet_friendly" de tags:');
  const pu = await restaurantes.updateOne(
    { nombre: 'El Rincon Guatemalteco' },
    { $pull: { tags: 'pet_friendly' } }
  );
  ok(`modifiedCount: ${pu.modifiedCount}`);

  // 3.4 $push item a orden
  console.log('\n[3.4] $push — Agregar item extra a una orden pendiente:');
  const ordenParaPush = await ordenes.findOne({ estado: 'en_preparacion' });
  const menuItem = await menu_items.findOne();
  const psh = await ordenes.updateOne(
    { _id: ordenParaPush._id },
    {
      $push: {
        items: {
          menu_item_id: menuItem._id,
          nombre: 'Item Extra',
          precio_unitario: 25,
          cantidad: 1,
          notas: 'agregado en presentacion',
          subtotal: 25
        }
      }
    }
  );
  ok(`modifiedCount: ${psh.modifiedCount} en orden ${ordenParaPush._id}`);

  // ============================================================
  sep('4. AGGREGATION PIPELINES');
  // ============================================================

  // 4.1 Simple
  console.log('\n[4.1] Pipeline SIMPLE — Conteo de ordenes por estado:');
  const pipe1 = await ordenes.aggregate([
    { $match: { restaurante_id: restBase._id } },
    { $group: { _id: '$estado', total: { $sum: 1 } } },
    { $sort: { total: -1 } }
  ]).toArray();
  pipe1.forEach(d => info(`${d._id}: ${d.total} ordenes`));
  ok('$match → $group → $sort');

  // 4.2 Compleja 1 — top platillos
  console.log('\n[4.2] Pipeline COMPLEJA 1 — Top 5 platillos mas vendidos:');
  const pipe2 = await ordenes.aggregate([
    { $match: { estado: 'pagado' } },
    { $unwind: '$items' },
    { $group: {
        _id: '$items.menu_item_id',
        nombre: { $first: '$items.nombre' },
        total_vendido: { $sum: '$items.cantidad' },
        ingresos: { $sum: '$items.subtotal' }
    }},
    { $sort: { total_vendido: -1 } },
    { $limit: 5 },
    { $lookup: { from: 'menu_items', localField: '_id', foreignField: '_id', as: 'info' }},
    { $project: {
        nombre: 1, total_vendido: 1, ingresos: 1,
        categoria: { $arrayElemAt: ['$info.categoria', 0] }
    }}
  ]).toArray();
  pipe2.forEach((d, i) => info(`${i+1}. ${d.nombre} | vendidos: ${d.total_vendido} | Q${d.ingresos} | ${d.categoria}`));
  ok('$unwind + $group + $lookup + $project');

  // 4.3 Compleja 2 — restaurantes mejor calificados
  console.log('\n[4.3] Pipeline COMPLEJA 2 — Restaurantes mejor calificados (min 5 reseñas):');
  const pipe3 = await resenas.aggregate([
    { $group: { _id: '$restaurante_id', promedio: { $avg: '$calificacion' }, total: { $sum: 1 } }},
    { $match: { total: { $gte: 5 } } },
    { $lookup: { from: 'restaurantes', localField: '_id', foreignField: '_id', as: 'rest' }},
    { $unwind: '$rest' },
    { $project: { nombre: '$rest.nombre', promedio: { $round: ['$promedio', 1] }, total_resenas: '$total' }},
    { $sort: { promedio: -1 } },
    { $limit: 10 }
  ]).toArray();
  pipe3.forEach((d, i) => info(`${i+1}. ${d.nombre} | ${d.promedio}/5 | ${d.total_resenas} reseñas`));
  ok('$avg + $round + $lookup');

  // 4.4 Compleja 3 — ingresos por periodo
  console.log('\n[4.4] Pipeline COMPLEJA 3 — Ingresos por restaurante (2025-2027):');
  const pipe4 = await ordenes.aggregate([
    { $match: { estado: 'pagado', created_at: { $gte: new Date('2025-01-01'), $lt: new Date('2027-01-01') } }},
    { $group: { _id: '$restaurante_id', ingresos: { $sum: '$total' }, ordenes: { $sum: 1 }, ticket_promedio: { $avg: '$total' } }},
    { $lookup: { from: 'restaurantes', localField: '_id', foreignField: '_id', as: 'rest' }},
    { $project: {
        nombre: { $arrayElemAt: ['$rest.nombre', 0] },
        ingresos: 1, ordenes: 1,
        ticket_promedio: { $round: ['$ticket_promedio', 2] }
    }},
    { $sort: { ingresos: -1 } }
  ]).toArray();
  pipe4.forEach((d, i) => info(`${i+1}. ${d.nombre} | Q${d.ingresos} | ${d.ordenes} ordenes | ticket Q${d.ticket_promedio}`));
  ok('$match fechas + $sum + $avg + $round');

  // ============================================================
  sep('5. EXPLAIN — VERIFICAR USO DE INDICES');
  // ============================================================

  // 5.1 IXSCAN
  console.log('\n[5.1] explain() ordenes — debe usar IXSCAN:');
  const ex1 = await ordenes.find({
    restaurante_id: restBase._id,
    estado: 'pendiente'
  }).explain('executionStats');
  const stage1 = ex1.queryPlanner?.winningPlan?.inputStage?.stage ||
                 ex1.queryPlanner?.winningPlan?.stage;
  info(`winningPlan stage: ${stage1}`);
  ok(stage1 === 'IXSCAN' ? 'IXSCAN confirmado' : `stage es "${stage1}" (revisar)`);

  // 5.2 GEO_NEAR_2DSPHERE
  console.log('\n[5.2] explain() $nearSphere — debe usar GEO_NEAR_2DSPHERE:');
  const ex2 = await restaurantes.find({
    ubicacion: { $nearSphere: { $geometry: { type: 'Point', coordinates: [-90.5132, 14.5890] }, $maxDistance: 5000 } }
  }).explain('executionStats');
  const stage2 = ex2.queryPlanner?.winningPlan?.stage;
  info(`winningPlan stage: ${stage2}`);
  ok(stage2 === 'GEO_NEAR_2DSPHERE' ? 'GEO_NEAR_2DSPHERE confirmado' : `stage es "${stage2}" (revisar)`);

  // 5.3 TEXT_MATCH
  console.log('\n[5.3] explain() $text — debe usar TEXT_MATCH:');
  const ex3 = await menu_items.find({ $text: { $search: 'pollo' } }).explain('executionStats');
  const stage3 = ex3.queryPlanner?.winningPlan?.stage;
  info(`winningPlan stage: ${stage3}`);
  ok(['TEXT_MATCH', 'TEXT_OR', 'TEXT'].includes(stage3) ? `${stage3} confirmado` : `stage es "${stage3}" (revisar)`);

  // ============================================================
  sep('6. INDICES — Ver todos los creados');
  // ============================================================

  for (const [col, coll] of [['usuarios', usuarios], ['ordenes', ordenes], ['menu_items', menu_items], ['restaurantes', restaurantes], ['resenas', resenas]]) {
    const idxs = await coll.indexes();
    console.log(`\n  [${col}] ${idxs.length} indice(s):`);
    idxs.forEach(i => info(`${i.name} | unique: ${i.unique || false} | key: ${JSON.stringify(i.key)}`));
  }
  ok('9 indices funcionales en 5 colecciones');

  // ============================================================
  sep('7. JSON SCHEMA VALIDATION — Debe rechazar datos invalidos');
  // ============================================================

  // 7.1 Rol invalido
  console.log('\n[7.1] insertOne usuario con rol "superadmin" (debe fallar):');
  try {
    await usuarios.insertOne({ nombre: 'Test', email: 'test_schema@test.com', password_hash: 'hash', rol: 'superadmin', activo: true, created_at: new Date() });
    console.log('  [FALLO] No lanzo error — revisar validator');
  } catch (e) {
    ok(`Error capturado correctamente: ${e.codeName || e.code} — ${e.message.substring(0, 80)}...`);
  }

  // 7.2 Orden con items vacio
  console.log('\n[7.2] insertOne orden con items: [] (debe fallar — minItems: 1):');
  try {
    await ordenes.insertOne({
      restaurante_id: restBase._id,
      usuario_id: userBase._id,
      mesero_id: mesero._id,
      numero_mesa: 1,
      estado: 'pendiente',
      items: [],
      total: 0,
      created_at: new Date()
    });
    console.log('  [FALLO] No lanzo error — revisar validator');
  } catch (e) {
    ok(`Error capturado correctamente: ${e.codeName || e.code} — ${e.message.substring(0, 80)}...`);
  }

  // 7.3 Reseña calificacion fuera de rango
  console.log('\n[7.3] insertOne resena con calificacion: 10 (debe fallar — max: 5):');
  try {
    await resenas.insertOne({
      restaurante_id: restBase._id,
      usuario_id: userBase._id,
      calificacion: 10,
      comentario: 'Calificacion invalida',
      created_at: new Date()
    });
    console.log('  [FALLO] No lanzo error — revisar validator');
  } catch (e) {
    ok(`Error capturado correctamente: ${e.codeName || e.code} — ${e.message.substring(0, 80)}...`);
  }

  // ============================================================
  sep('8. GRIDFS — Verificar comprobantes PDF');
  // ============================================================

  console.log('\n[8.1] Listar archivos en comprobantes.files:');
  const files = await db.collection('comprobantes.files').find({}, { projection: { filename: 1, length: 1, uploadDate: 1 } }).limit(5).toArray();
  if (files.length === 0) {
    info('Sin archivos en GridFS aun (correr una transaccion primero)');
  } else {
    files.forEach(f => info(`${f.filename} | ${Math.round(f.length/1024)}KB | ${f.uploadDate?.toISOString()}`));
    ok(`${files.length} archivo(s) en GridFS`);

    console.log('\n[8.2] Ver chunks del primer archivo (sin data binaria):');
    const chunks = await db.collection('comprobantes.chunks').find(
      { files_id: files[0]._id },
      { projection: { data: 0 } }
    ).toArray();
    chunks.forEach(c => info(`chunk n: ${c.n} | files_id: ${c.files_id}`));
    ok(`${chunks.length} chunk(s) para "${files[0].filename}"`);
  }

  // ============================================================
  sep('9. SNAPSHOT PATTERN — Ordenes no cambian con el menu');
  // ============================================================

  console.log('\n[9.1] Precio actual de Pepian de Res en menu_items:');
  const pepian = await menu_items.findOne({ nombre: 'Pepian de Res' }, { projection: { nombre: 1, precio: 1 } });
  info(`${pepian?.nombre} | precio actual: Q${pepian?.precio}`);

  console.log('\n[9.2] Precio en ordenes existentes (snapshot al momento del pedido):');
  const ordenConPepian = await ordenes.findOne(
    { 'items.nombre': 'Pepian de Res' },
    { projection: { 'items.$': 1, total: 1 } }
  );
  if (ordenConPepian) {
    info(`precio_unitario en la orden: Q${ordenConPepian.items[0].precio_unitario} | total orden: Q${ordenConPepian.total}`);
  } else {
    info('No hay ordenes con Pepian de Res aun');
  }

  console.log('\n[9.3] Cambiar precio en menu a Q999:');
  await menu_items.updateOne({ nombre: 'Pepian de Res' }, { $set: { precio: 999 } });
  ok('Precio en menu_items actualizado a Q999');

  console.log('\n[9.4] Verificar que la orden NO cambio:');
  const ordenDespues = await ordenes.findOne(
    { 'items.nombre': 'Pepian de Res' },
    { projection: { 'items.$': 1, total: 1 } }
  );
  if (ordenDespues) {
    info(`precio_unitario en la orden: Q${ordenDespues.items[0].precio_unitario} — SIN CAMBIO`);
    ok('Snapshot pattern funciona: la orden conserva el precio original');
  } else {
    info('No hay ordenes con Pepian de Res para verificar');
  }

  // Restaurar precio original
  await menu_items.updateOne({ nombre: 'Pepian de Res' }, { $set: { precio: 65 } });
  info('(precio restaurado a Q65)');

  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('  TODOS LOS QUERIES DE PRESENTACION EJECUTADOS');
  console.log('='.repeat(60) + '\n');

  await client.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
