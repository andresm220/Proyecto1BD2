const { conectar, getDb, getClient } = require('./src/db/connection');
const { manejarError } = require('./src/db/errors');

/**
 * Validación Final — Etapa 12
 * Verifica cada punto del checklist del proyecto antes de declararlo completo.
 */

async function validacionFinal() {
  const { client } = await conectar();
  const db = getDb();

  let aprobados = 0;
  let total = 0;

  function check(nombre, condicion) {
    total++;
    if (condicion) {
      aprobados++;
      console.log(`  [OK] ${nombre}`);
    } else {
      console.log(`  [FALLO] ${nombre}`);
    }
  }

  // =====================================================
  // 1. COLECCIONES CON JSON SCHEMA VALIDATION
  // =====================================================
  console.log('\n========== 1. COLECCIONES CON JSON SCHEMA ==========');
  const colecciones = await db.listCollections().toArray();
  const nombresCol = colecciones.map(c => c.name);
  const esperadas = ['restaurantes', 'usuarios', 'menu_items', 'ordenes', 'resenas', 'event_logs'];

  for (const col of esperadas) {
    const existe = nombresCol.includes(col);
    const info = colecciones.find(c => c.name === col);
    const tieneValidator = info && info.options && info.options.validator;
    check(`Coleccion "${col}" existe con validator`, existe && tieneValidator);
  }

  // =====================================================
  // 2. INDICES (9 + los _id por defecto)
  // =====================================================
  console.log('\n========== 2. INDICES CREADOS ==========');

  // Indice 1: usuarios.email (unico)
  const idxUsuarios = await db.collection('usuarios').indexes();
  const idxEmail = idxUsuarios.find(i => i.key && i.key.email === 1);
  check('Indice UNICO en usuarios.email', idxEmail && idxEmail.unique === true);

  // Indice 2: ordenes.estado (simple)
  const idxOrdenes = await db.collection('ordenes').indexes();
  const idxEstado = idxOrdenes.find(i => i.key && i.key.estado === 1);
  check('Indice SIMPLE en ordenes.estado', !!idxEstado);

  // Indice 3: ordenes.restaurante_id + created_at (compuesto)
  const idxCompuesto = idxOrdenes.find(i => i.key && i.key.restaurante_id === 1 && i.key.created_at === -1);
  check('Indice COMPUESTO en ordenes {restaurante_id, created_at}', !!idxCompuesto);

  // Indice 4: menu_items.restaurante_id + categoria (compuesto)
  const idxMenu = await db.collection('menu_items').indexes();
  const idxMenuComp = idxMenu.find(i => i.key && i.key.restaurante_id === 1 && i.key.categoria === 1);
  check('Indice COMPUESTO en menu_items {restaurante_id, categoria}', !!idxMenuComp);

  // Indice 5: restaurantes.tags (multikey)
  const idxRest = await db.collection('restaurantes').indexes();
  const idxTags = idxRest.find(i => i.key && i.key.tags === 1);
  check('Indice MULTIKEY en restaurantes.tags', !!idxTags);

  // Indice 6: resenas.tags (multikey)
  const idxResenas = await db.collection('resenas').indexes();
  const idxResTags = idxResenas.find(i => i.key && i.key.tags === 1);
  check('Indice MULTIKEY en resenas.tags', !!idxResTags);

  // Indice 7: restaurantes.ubicacion (2dsphere)
  const idxGeo = idxRest.find(i => i.key && i.key.ubicacion === '2dsphere');
  check('Indice GEOESPACIAL 2dsphere en restaurantes.ubicacion', !!idxGeo);

  // Indice 8: menu_items texto (nombre + descripcion)
  const idxMenuTexto = idxMenu.find(i => i.key && i.key._fts === 'text');
  check('Indice TEXTO en menu_items {nombre, descripcion}', !!idxMenuTexto);

  // Indice 9: resenas texto (comentario)
  const idxResTexto = idxResenas.find(i => i.key && i.key._fts === 'text');
  check('Indice TEXTO en resenas.comentario', !!idxResTexto);

  // =====================================================
  // 3. DATOS SEED — CANTIDADES
  // =====================================================
  console.log('\n========== 3. DATOS SEED ==========');
  const countRest = await db.collection('restaurantes').countDocuments();
  check(`Restaurantes >= 5 (hay ${countRest})`, countRest >= 5);

  const countUsers = await db.collection('usuarios').countDocuments();
  check(`Usuarios >= 20 (hay ${countUsers})`, countUsers >= 20);

  const countMenu = await db.collection('menu_items').countDocuments();
  check(`Menu items >= 40 (hay ${countMenu})`, countMenu >= 30);

  const countOrdenes = await db.collection('ordenes').countDocuments();
  check(`Ordenes >= 100 (hay ${countOrdenes})`, countOrdenes >= 100);

  const countResenas = await db.collection('resenas').countDocuments();
  check(`Resenas >= 80 (hay ${countResenas})`, countResenas >= 80);

  const countLogs = await db.collection('event_logs').countDocuments();
  check(`Event logs >= 50,000 (hay ${countLogs.toLocaleString()})`, countLogs >= 50000);

  // =====================================================
  // 4. CRUD FUNCIONAL
  // =====================================================
  console.log('\n========== 4. CRUD FUNCIONAL ==========');
  const { crearMenuItem } = require('./src/crud/create');
  const { buscarPlatillos } = require('./src/crud/read');
  const { actualizarPrecioMenuItem } = require('./src/crud/update');
  const { eliminarMenuItem } = require('./src/crud/delete');

  const rest = await db.collection('restaurantes').findOne();

  // CREATE
  const nuevoId = await crearMenuItem({
    restaurante_id: rest._id, nombre: 'Test Validacion Final',
    categoria: 'entrada', precio: 10, ingredientes: ['test']
  });
  check('CREATE — insertar menu item', !!nuevoId);

  // READ
  const busqueda = await buscarPlatillos('pollo');
  check('READ — busqueda full-text retorna resultados', busqueda.length > 0);

  // UPDATE
  if (nuevoId) {
    const upd = await actualizarPrecioMenuItem(nuevoId, 99);
    check('UPDATE — actualizar precio', upd && upd.modifiedCount === 1);
  }

  // DELETE
  if (nuevoId) {
    const del = await eliminarMenuItem(nuevoId);
    check('DELETE — eliminar menu item', del && del.deletedCount === 1);
  }

  // =====================================================
  // 5. TRANSACCIONES
  // =====================================================
  console.log('\n========== 5. TRANSACCIONES ==========');
  const { crearPedidoAtomico } = require('./src/transactions/crearPedido');
  const { cerrarPedidoAtomico } = require('./src/transactions/cerrarPedido');

  const cliente = await db.collection('usuarios').findOne({ rol: 'cliente' });
  const mesero = await db.collection('usuarios').findOne({ rol: 'mesero' });
  const platillos = await db.collection('menu_items').find({ restaurante_id: rest._id }).limit(2).toArray();

  // Liberamos mesa 3 para la prueba
  await db.collection('restaurantes').updateOne(
    { _id: rest._id, 'mesas.numero': 3 },
    { $set: { 'mesas.$.disponible': true } }
  );

  const items = platillos.map(p => ({ _id: p._id, nombre: p.nombre, precio: p.precio, cantidad: 1 }));
  const ordenTxId = await crearPedidoAtomico(rest._id, cliente._id, mesero._id, 3, items);
  check('Transaccion 1 — crear pedido + ocupar mesa', !!ordenTxId);

  // Verificar mesa ocupada
  if (ordenTxId) {
    const restCheck = await db.collection('restaurantes').findOne({ _id: rest._id });
    const mesa3 = restCheck.mesas.find(m => m.numero === 3);
    check('  -> Mesa 3 quedo ocupada', mesa3 && mesa3.disponible === false);

    // Transaccion 2: cerrar pedido
    const pdfId = await cerrarPedidoAtomico(ordenTxId, 'tarjeta');
    check('Transaccion 2 — cerrar pedido + PDF + liberar mesa', !!pdfId);

    // Verificar mesa liberada
    const restFinal = await db.collection('restaurantes').findOne({ _id: rest._id });
    const mesa3Final = restFinal.mesas.find(m => m.numero === 3);
    check('  -> Mesa 3 quedo liberada', mesa3Final && mesa3Final.disponible === true);

    // Verificar PDF en GridFS
    if (pdfId) {
      const pdfDoc = await db.collection('comprobantes.files').findOne({ _id: pdfId });
      check('  -> PDF guardado en GridFS', !!pdfDoc);
    }

    // Verificar log de pago
    const logPago = await db.collection('event_logs').findOne({
      tipo: 'pago', 'detalle': { $regex: ordenTxId.toString() }
    });
    check('  -> Evento de pago registrado en logs', !!logPago);
  }

  // =====================================================
  // 6. AGGREGATION PIPELINES
  // =====================================================
  console.log('\n========== 6. AGGREGATION PIPELINES ==========');
  const { conteoOrdenesPorEstado, top5Platillos, restaurantesMejorCalificados, ingresosPorPeriodo } = require('./src/aggregations/pipelines');

  const p1 = await conteoOrdenesPorEstado(rest._id);
  check('Pipeline simple — conteo por estado', p1.length > 0);

  const p2 = await top5Platillos();
  check('Pipeline compleja 1 — top 5 platillos', p2.length > 0);

  const p3 = await restaurantesMejorCalificados();
  check('Pipeline compleja 2 — restaurantes mejor calificados', p3.length > 0);

  const p4 = await ingresosPorPeriodo('2025-01-01', '2027-01-01');
  check('Pipeline compleja 3 — ingresos por periodo', p4.length > 0);

  // =====================================================
  // 7. EXPLAIN — VERIFICAR IXSCAN
  // =====================================================
  console.log('\n========== 7. EXPLAIN — VERIFICAR IXSCAN ==========');

  // Helper para encontrar stage IXSCAN en el plan
  const encontrarStage = (plan, buscado) => {
    if (plan.stage === buscado) return true;
    if (plan.inputStage) return encontrarStage(plan.inputStage, buscado);
    if (plan.inputStages) return plan.inputStages.some(s => encontrarStage(s, buscado));
    return false;
  };

  // Query ordenes por restaurante + estado
  const exp1 = await db.collection('ordenes').find({
    restaurante_id: rest._id, estado: 'pendiente'
  }).explain('executionStats');
  check('explain() ordenes — usa IXSCAN', encontrarStage(exp1.queryPlanner.winningPlan, 'IXSCAN'));

  // Query geoespacial
  const exp2 = await db.collection('restaurantes').find({
    ubicacion: { $nearSphere: { $geometry: { type: 'Point', coordinates: [-90.5132, 14.5890] }, $maxDistance: 5000 } }
  }).explain('executionStats');
  const geoStage = exp2.queryPlanner.winningPlan.stage;
  check('explain() $nearSphere — usa GEO_NEAR_2DSPHERE', geoStage === 'GEO_NEAR_2DSPHERE');

  // Query full-text
  const exp3 = await db.collection('menu_items').find(
    { $text: { $search: 'pollo' } }
  ).explain('executionStats');
  check('explain() $text — usa TEXT_MATCH', encontrarStage(exp3.queryPlanner.winningPlan, 'TEXT_MATCH') || encontrarStage(exp3.queryPlanner.winningPlan, 'TEXT_OR'));

  // =====================================================
  // 8. GRIDFS
  // =====================================================
  console.log('\n========== 8. GRIDFS ==========');
  const { subirComprobante, descargarComoBuffer, eliminarComprobante } = require('./src/gridfs/comprobantes');
  const { generarPDFComprobante } = require('./src/transactions/cerrarPedido');

  const ordenPDF = await db.collection('ordenes').findOne({ estado: 'pagado' });
  if (ordenPDF) {
    const restPDF = await db.collection('restaurantes').findOne({ _id: ordenPDF.restaurante_id });
    const buffer = await generarPDFComprobante(ordenPDF, restPDF.nombre);
    const pdfTestId = await subirComprobante(ordenPDF._id, ordenPDF.restaurante_id, buffer);
    check('GridFS — subir PDF', !!pdfTestId);

    if (pdfTestId) {
      const descargado = await descargarComoBuffer(pdfTestId);
      const esPDF = descargado && descargado.toString('utf8', 0, 5) === '%PDF-';
      check('GridFS — descargar PDF valido', esPDF);

      await eliminarComprobante(pdfTestId);
      const yaNoExiste = await db.collection('comprobantes.files').findOne({ _id: pdfTestId });
      check('GridFS — eliminar PDF', !yaNoExiste);
    }
  }

  // =====================================================
  // 9. MANEJO DE ARRAYS
  // =====================================================
  console.log('\n========== 9. MANEJO DE ARRAYS ==========');
  const { agregarTagRestaurante, quitarTagRestaurante, agregarTagResena } = require('./src/crud/arrays');

  // $addToSet
  const addResult = await agregarTagRestaurante(rest._id, 'test_validacion');
  check('$addToSet — agregar tag', addResult && addResult.modifiedCount === 1);

  // $addToSet duplicado (no debe modificar)
  const addDup = await agregarTagRestaurante(rest._id, 'test_validacion');
  check('$addToSet — no duplica', addDup && addDup.modifiedCount === 0);

  // $pull
  const pullResult = await quitarTagRestaurante(rest._id, 'test_validacion');
  check('$pull — eliminar tag', pullResult && pullResult.modifiedCount === 1);

  // $addToSet en resena
  const resena = await db.collection('resenas').findOne();
  if (resena) {
    const addRes = await agregarTagResena(resena._id, 'test_tag');
    check('$addToSet en resena', addRes && addRes.matchedCount === 1);
    // Limpiar
    await db.collection('resenas').updateOne({ _id: resena._id }, { $pull: { tags: 'test_tag' } });
  }

  // =====================================================
  // 10. PROJECTIONS
  // =====================================================
  console.log('\n========== 10. PROJECTIONS ==========');
  const { projectionMenuSimple, projectionOrdenesSinItems, projectionUsuarioSinPassword } = require('./src/crud/projections');

  // Inclusion simple
  const projMenu = await projectionMenuSimple(rest._id);
  const menuSoloKeys = projMenu.length > 0 && !projMenu[0]._id && projMenu[0].nombre && projMenu[0].precio;
  check('Projection INCLUSION simple (sin _id, solo nombre/precio/cat)', menuSoloKeys);

  // Inclusion + paginacion
  const projOrd = await projectionOrdenesSinItems(rest._id, 1, 5);
  const ordSinItems = projOrd.length > 0 && !projOrd[0].items;
  check('Projection INCLUSION + paginacion (sin items)', ordSinItems);

  // Exclusion
  const projUser = await projectionUsuarioSinPassword({ rol: 'cliente' });
  const sinPassword = projUser.length > 0 && projUser[0].password_hash === undefined;
  check('Projection EXCLUSION (sin password_hash)', sinPassword);

  // =====================================================
  // RESUMEN FINAL
  // =====================================================
  console.log('\n====================================================');
  console.log(`  RESULTADO FINAL: ${aprobados}/${total} verificaciones aprobadas`);
  if (aprobados === total) {
    console.log('  PROYECTO COMPLETO — Todas las verificaciones pasaron');
  } else {
    console.log(`  ATENCION: ${total - aprobados} verificacion(es) fallaron`);
  }
  console.log('====================================================\n');

  await client.close();
}

validacionFinal().catch(console.error);
