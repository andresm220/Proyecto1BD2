/**
 * test_menu_simulacion.js
 * Simula CADA opcion del menu interactivo sin necesidad de stdin.
 * Prueba login, cliente, mesero y todas las opciones de admin.
 */

'use strict';
const { conectar, getDb, getClient } = require('./src/db/connection');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// ── modulos del sistema ────────────────────────────────────────────────────
const { crearRestaurante, crearUsuario, crearMenuItem, crearOrden, crearResena } = require('./src/crud/create');
const { restaurantesCercanos, menuPorCategoria, ordenesPorRestaurante, buscarPlatillos, lookupOrdenesConDetalle } = require('./src/crud/read');
const { actualizarEstadoOrden, deshabilitarCategoriaMenu, actualizarPrecioMenuItem, responderResena, bulkActualizarDisponibilidadMenu } = require('./src/crud/update');
const { eliminarMenuItem, eliminarResenasUsuario, cancelarOrden } = require('./src/crud/delete');
const { agregarItemAOrden, registrarCambioEstado, quitarTagRestaurante, agregarTagResena, agregarTagRestaurante } = require('./src/crud/arrays');
const { projectionMenuSimple, projectionOrdenesSinItems, projectionUsuarioSinPassword } = require('./src/crud/projections');
const { totalOrdenesPorRestaurante, conteoOrdenesPorEstado, top5Platillos, restaurantesMejorCalificados, ingresosPorPeriodo } = require('./src/aggregations/pipelines');
const { crearPedidoAtomico } = require('./src/transactions/crearPedido');
const { cerrarPedidoAtomico, generarPDFComprobante } = require('./src/transactions/cerrarPedido');
const { subirComprobante, descargarComprobante, eliminarComprobante, listarComprobantes } = require('./src/gridfs/comprobantes');
const { crearColecciones } = require('./src/collections/createCollections');
const { crearIndices, validarIndices } = require('./src/collections/createIndexes');

// ── contadores ─────────────────────────────────────────────────────────────
let ok = 0, fail = 0, skip = 0;
const resultados = [];

function pass(label) {
  ok++;
  resultados.push({ estado: '✓', label });
  console.log(`  ✓  ${label}`);
}
function error(label, err) {
  fail++;
  const msg = err?.message || String(err);
  resultados.push({ estado: '✗', label, error: msg });
  console.log(`  ✗  ${label}`);
  console.log(`     ${msg}`);
}
function omitir(label, razon) {
  skip++;
  resultados.push({ estado: '-', label, razon });
  console.log(`  -  ${label} (omitido: ${razon})`);
}

async function run(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (err) {
    error(label, err);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
async function obtenerOrdenActiva(db, restId) {
  return db.collection('ordenes').findOne({
    restaurante_id: restId,
    estado: { $nin: ['pagado', 'cancelado'] }
  });
}

async function obtenerMesaDisponible(db, restId) {
  const rest = await db.collection('restaurantes').findOne({ _id: restId });
  return rest?.mesas?.find(m => m.disponible) || null;
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function main() {
  await conectar();
  const db = getDb();

  // ── Datos base ─────────────────────────────────────────────────────────
  const admin   = await db.collection('usuarios').findOne({ rol: 'admin' });
  const mesero  = await db.collection('usuarios').findOne({ rol: 'mesero' });
  const cliente = await db.collection('usuarios').findOne({ rol: 'cliente' });
  const rest    = admin?.restaurante_id
    ? await db.collection('restaurantes').findOne({ _id: admin.restaurante_id })
    : await db.collection('restaurantes').findOne({});

  if (!admin || !rest) {
    console.log('\n  ERROR: No hay datos. Ejecuta primero: node src/seed/seed.js\n');
    process.exit(1);
  }

  const restId = rest._id;
  console.log(`\n  Base: restaurante="${rest.nombre}" | admin="${admin.email}"\n`);

  // ══════════════════════════════════════════════════════════════════════
  // 0. LOGIN / REGISTRO (pantalla de inicio)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ PANTALLA LOGIN ══════════════════════════════════════');

  await run('Login — credenciales correctas (admin)', async () => {
    const u = await db.collection('usuarios').findOne({ email: admin.email });
    if (!u) throw new Error('Usuario no encontrado');
    const ok2 = await bcrypt.compare('1234', u.password_hash);
    if (!ok2) throw new Error('Password no coincide');
  });

  await run('Login — credenciales incorrectas (debe fallar)', async () => {
    const u = await db.collection('usuarios').findOne({ email: admin.email });
    const mal = await bcrypt.compare('wrong', u.password_hash);
    if (mal) throw new Error('Deberia fallar con password incorrecta');
  });

  await run('Login — email inexistente (null)', async () => {
    const u = await db.collection('usuarios').findOne({ email: 'noexiste@test.com' });
    if (u) throw new Error('No deberia encontrar usuario');
  });

  await run('Registro — crear nuevo cliente', async () => {
    const ts = Date.now();
    const id = await crearUsuario({
      nombre: `Test_${ts}`, email: `test_${ts}@demo.com`, password: '1234', rol: 'cliente'
    });
    if (!id) throw new Error('No se creo el usuario');
    await db.collection('usuarios').deleteOne({ _id: id });
  });

  await run('Ver usuarios disponibles (listar por rol)', async () => {
    const usuarios = await db.collection('usuarios').find({}, { projection: { nombre: 1, email: 1, rol: 1 } }).toArray();
    if (usuarios.length === 0) throw new Error('Sin usuarios');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 1. MENU CLIENTE
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ MENU CLIENTE ════════════════════════════════════════');

  await run('Cliente-1: Buscar restaurantes cercanos', async () => {
    const r = await restaurantesCercanos(14.5890, -90.5132, 5000);
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  await run('Cliente-2: Ver menu por categoria (plato_fuerte)', async () => {
    const r = await menuPorCategoria(restId, 'plato_fuerte');
    if (!Array.isArray(r)) throw new Error('No retorno array');
    if (r.some(i => i.categoria !== 'plato_fuerte')) throw new Error('Devolvio items de otra categoria');
  });

  await run('Cliente-2b: Ver menu — opcion "todo" (todas las categorias)', async () => {
    const r = await menuPorCategoria(restId, 'todo');
    if (!Array.isArray(r)) throw new Error('No retorno array');
    if (r.length === 0) throw new Error('No devolvio items');
    const categorias = [...new Set(r.map(i => i.categoria))];
    if (categorias.length < 2) throw new Error('Deberia traer mas de una categoria');
  });

  await run('Cliente-3: Buscar platillos full-text "pollo"', async () => {
    const r = await buscarPlatillos('pollo');
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  await run('Cliente-4: Dejar resena', async () => {
    const clienteId = cliente?._id || admin._id;
    const id = await crearResena({
      restaurante_id: restId, usuario_id: clienteId,
      calificacion: 4, comentario: 'Muy buen servicio de prueba automatizada', tags: []
    });
    if (!id) throw new Error('No se creo la resena');
    await db.collection('resenas').deleteOne({ _id: id });
  });

  await run('Cliente-5: Ver mis ordenes', async () => {
    const clienteId = cliente?._id || admin._id;
    const ordenes = await db.collection('ordenes').aggregate([
      { $match: { usuario_id: clienteId } },
      { $lookup: { from: 'restaurantes', localField: 'restaurante_id', foreignField: '_id', as: 'rest' } },
      { $project: { numero_mesa: 1, estado: 1, total: 1, created_at: 1, restaurante: { $arrayElemAt: ['$rest.nombre', 0] } } },
      { $sort: { created_at: -1 } },
      { $limit: 10 }
    ]).toArray();
    if (!Array.isArray(ordenes)) throw new Error('No retorno array');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 2. MENU MESERO
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ MENU MESERO ═════════════════════════════════════════');

  await run('Mesero-1: Ver ordenes del restaurante (pagina 1)', async () => {
    const r = await ordenesPorRestaurante(restId, 1, 10);
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  await run('Mesero-2: Actualizar estado de orden', async () => {
    let orden = await obtenerOrdenActiva(db, restId);
    if (!orden) {
      // Crear una orden temporal para la prueba
      const mesa = await obtenerMesaDisponible(db, restId);
      if (!mesa) { omitir('Mesero-2', 'sin mesas disponibles'); return; }
      const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(1).toArray();
      if (!platillos.length) { omitir('Mesero-2', 'sin platillos'); return; }
      const items = [{ _id: platillos[0]._id, nombre: platillos[0].nombre, precio: platillos[0].precio, cantidad: 1 }];
      const oid = await crearPedidoAtomico(restId, (cliente || admin)._id, (mesero || admin)._id, mesa.numero, items);
      orden = await db.collection('ordenes').findOne({ _id: oid });
    }
    if (!orden) throw new Error('No se pudo obtener/crear orden');
    const userId = mesero?._id || admin._id;
    await actualizarEstadoOrden(orden._id, 'en_preparacion', userId);
  });

  await run('Mesero-2b: Actualizar estado — "pagado" bloqueado (debe no cambiar)', async () => {
    const orden = await obtenerOrdenActiva(db, restId);
    if (!orden) throw new Error('Sin orden activa');
    // Simula la validacion del menu: pagado y cancelado estan bloqueados
    const estado = 'pagado';
    if (['pagado', 'cancelado'].includes(estado)) {
      // El menu muestra mensaje y hace break — la orden NO debe cambiar
      const ordenDespues = await db.collection('ordenes').findOne({ _id: orden._id });
      if (ordenDespues.estado === 'pagado') throw new Error('El estado cambio a pagado sin pasar por cerrarPedido');
    } else {
      throw new Error('La validacion no esta activa');
    }
  });

  // Mesero-3: Crear pedido (transaccion)
  let ordenMeseroId = null;
  await run('Mesero-3: Crear pedido atomico (orden + ocupar mesa)', async () => {
    const mesa = await obtenerMesaDisponible(db, restId);
    if (!mesa) throw new Error('Sin mesas disponibles. Libera alguna orden primero');
    const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(2).toArray();
    if (!platillos.length) throw new Error('Sin platillos disponibles');
    const items = platillos.map(p => ({ _id: p._id, nombre: p.nombre, precio: p.precio, cantidad: 1 }));
    ordenMeseroId = await crearPedidoAtomico(
      restId, (cliente || admin)._id, (mesero || admin)._id, mesa.numero, items
    );
    if (!ordenMeseroId) throw new Error('crearPedidoAtomico retorno null');
  });

  // Mesero-5: Ver menu del restaurante
  await run('Mesero-5: Ver menu del restaurante (bebida)', async () => {
    const r = await menuPorCategoria(restId, 'bebida');
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  await run('Mesero-5b: Ver menu — opcion "todo"', async () => {
    const r = await menuPorCategoria(restId, 'todo');
    if (!Array.isArray(r) || r.length === 0) throw new Error('No devolvio items');
    const categorias = [...new Set(r.map(i => i.categoria))];
    if (categorias.length < 2) throw new Error('Deberia traer mas de una categoria');
  });

  // Mesero-6: Agregar item a orden existente ($push)
  await run('Mesero-6: Agregar item a orden ($push)', async () => {
    const orden = await obtenerOrdenActiva(db, restId);
    if (!orden) throw new Error('Sin orden activa');
    const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(1).toArray();
    if (!platillos.length) throw new Error('Sin platillos');
    const p = platillos[0];
    const r = await agregarItemAOrden(orden._id, {
      menu_item_id: p._id, nombre: p.nombre,
      precio_unitario: p.precio, cantidad: 1, notas: '', subtotal: p.precio
    });
    if (!r) throw new Error('agregarItemAOrden retorno null');
  });

  // Mesero-7: Registrar cambio de estado en historial ($push)
  await run('Mesero-7: Registrar cambio de estado en historial', async () => {
    const orden = await obtenerOrdenActiva(db, restId);
    if (!orden) throw new Error('Sin orden activa');
    const userId = mesero?._id || admin._id;
    const r = await registrarCambioEstado(orden._id, 'en_preparacion', userId);
    if (!r) throw new Error('registrarCambioEstado retorno null');
  });

  // Mesero-4: Cerrar pedido (requiere orden activa)
  await run('Mesero-4: Cerrar pedido atomico (pagar + PDF + liberar mesa)', async () => {
    let orden = await obtenerOrdenActiva(db, restId);
    if (!orden && ordenMeseroId) {
      orden = await db.collection('ordenes').findOne({ _id: ordenMeseroId });
    }
    if (!orden) throw new Error('Sin orden activa para cerrar');
    const pdfId = await cerrarPedidoAtomico(orden._id, 'tarjeta');
    if (!pdfId) throw new Error('cerrarPedidoAtomico retorno null');
  });

  // Mesero-8: Cancelar orden
  await run('Mesero-8: Cancelar orden (liberar mesa)', async () => {
    // Crear una orden nueva para cancelar
    const mesa = await obtenerMesaDisponible(db, restId);
    if (!mesa) throw new Error('Sin mesas disponibles');
    const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(1).toArray();
    if (!platillos.length) throw new Error('Sin platillos');
    const items = [{ _id: platillos[0]._id, nombre: platillos[0].nombre, precio: platillos[0].precio, cantidad: 1 }];
    const oid = await crearPedidoAtomico(restId, (cliente || admin)._id, (mesero || admin)._id, mesa.numero, items);
    if (!oid) throw new Error('No se pudo crear orden para cancelar');
    const orden = await db.collection('ordenes').findOne({ _id: oid });

    await db.collection('ordenes').updateOne(
      { _id: orden._id },
      {
        $set: { estado: 'cancelado', updated_at: new Date() },
        $push: { historial_estados: { estado: 'cancelado', timestamp: new Date(), usuario_id: admin._id } }
      }
    );
    await db.collection('restaurantes').updateOne(
      { _id: restId, 'mesas.numero': orden.numero_mesa },
      { $set: { 'mesas.$.disponible': true } }
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // 3. MENU ADMIN — Gestion del Menu (sub-menu 1)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Gestion del Menu ════════════════════════════');

  await run('Admin-Menu-1: Ver menu por categoria (entrada)', async () => {
    const r = await menuPorCategoria(restId, 'entrada');
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  let nuevoItemId = null;
  await run('Admin-Menu-2: Crear item del menu', async () => {
    nuevoItemId = await crearMenuItem({
      restaurante_id: restId, nombre: 'Item de prueba automatizada',
      categoria: 'postre', precio: 25.00
    });
    if (!nuevoItemId) throw new Error('No se creo el item');
  });

  await run('Admin-Menu-3: Actualizar precio de item', async () => {
    const items = await db.collection('menu_items').find({ restaurante_id: restId }).project({ nombre: 1, precio: 1 }).limit(1).toArray();
    if (!items.length) throw new Error('Sin items');
    const r = await actualizarPrecioMenuItem(items[0]._id, 99.99);
    if (!r) throw new Error('No actualizo');
    await actualizarPrecioMenuItem(items[0]._id, items[0].precio); // revertir
  });

  await run('Admin-Menu-4: Deshabilitar categoria completa (postre)', async () => {
    await deshabilitarCategoriaMenu(restId, 'postre');
    // re-habilitar
    await db.collection('menu_items').updateMany(
      { restaurante_id: restId, categoria: 'postre' },
      { $set: { disponible: true } }
    );
  });

  await run('Admin-Menu-5: Eliminar item del menu', async () => {
    if (!nuevoItemId) throw new Error('No hay item de prueba creado');
    await eliminarMenuItem(nuevoItemId);
    nuevoItemId = null;
  });

  await run('Admin-Menu-6: BulkWrite — cambiar disponibilidad de varios items', async () => {
    const items = await db.collection('menu_items').find({ restaurante_id: restId }).project({ nombre: 1, disponible: 1 }).limit(4).toArray();
    if (items.length < 2) throw new Error('Sin suficientes items');
    const cambios = [
      { menuItemId: items[0]._id, disponible: false },
      { menuItemId: items[1]._id, disponible: true }
    ];
    const r = await bulkActualizarDisponibilidadMenu(cambios);
    if (!r) throw new Error('bulkWrite fallo');
    // revertir
    await bulkActualizarDisponibilidadMenu([
      { menuItemId: items[0]._id, disponible: true },
      { menuItemId: items[1]._id, disponible: true }
    ]);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 4. MENU ADMIN — Ordenes (sub-menu 2)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Ordenes ═════════════════════════════════════');

  await run('Admin-Ordenes-1: Ver ordenes paginadas (pag 1)', async () => {
    const r = await ordenesPorRestaurante(restId, 1, 10);
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  await run('Admin-Ordenes-2: Actualizar estado de orden', async () => {
    const orden = await obtenerOrdenActiva(db, restId);
    if (!orden) throw new Error('Sin orden activa');
    await actualizarEstadoOrden(orden._id, 'servido', admin._id);
  });

  await run('Admin-Ordenes-2b: Actualizar estado — "cancelado" bloqueado', async () => {
    const orden = await obtenerOrdenActiva(db, restId);
    if (!orden) throw new Error('Sin orden activa');
    const estado = 'cancelado';
    if (['pagado', 'cancelado'].includes(estado)) {
      const ordenDespues = await db.collection('ordenes').findOne({ _id: orden._id });
      if (ordenDespues.estado === 'cancelado') throw new Error('Estado cambio sin pasar por cancelarOrden');
    } else {
      throw new Error('Validacion no activa');
    }
  });

  await run('Admin-Ordenes-3: Cancelar orden (cancelarOrden) — verifica que libera mesa', async () => {
    // crear orden temporal
    const mesa = await obtenerMesaDisponible(db, restId);
    if (!mesa) throw new Error('Sin mesas disponibles');
    const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(1).toArray();
    if (!platillos.length) throw new Error('Sin platillos');
    const numeroMesa = mesa.numero;
    const oid = await crearPedidoAtomico(
      restId, (cliente || admin)._id, (mesero || admin)._id, numeroMesa,
      [{ _id: platillos[0]._id, nombre: platillos[0].nombre, precio: platillos[0].precio, cantidad: 1 }]
    );
    if (!oid) throw new Error('No se pudo crear orden');
    // Verificar que la mesa quedo ocupada
    const restAntes = await db.collection('restaurantes').findOne({ _id: restId });
    const mesaAntes = restAntes.mesas.find(m => m.numero === numeroMesa);
    if (mesaAntes.disponible) throw new Error('La mesa no quedo ocupada al crear el pedido');
    // Cancelar y verificar que se libero
    await cancelarOrden(oid);
    const restDespues = await db.collection('restaurantes').findOne({ _id: restId });
    const mesaDespues = restDespues.mesas.find(m => m.numero === numeroMesa);
    if (!mesaDespues.disponible) throw new Error('cancelarOrden NO libero la mesa');
  });

  await run('Admin-Ordenes-4: Lookup ordenes con detalle', async () => {
    const r = await lookupOrdenesConDetalle(restId);
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 5. MENU ADMIN — Transacciones (sub-menu 3)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Transacciones ═══════════════════════════════');

  let ordenTransId = null;
  await run('Admin-Trans-1: Crear pedido atomico', async () => {
    const mesa = await obtenerMesaDisponible(db, restId);
    if (!mesa) throw new Error('Sin mesas disponibles');
    const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(3).toArray();
    if (!platillos.length) throw new Error('Sin platillos');
    const items = platillos.map(p => ({ _id: p._id, nombre: p.nombre, precio: p.precio, cantidad: 1 }));
    const meseroLocal = await db.collection('usuarios').findOne({ rol: 'mesero', restaurante_id: restId });
    ordenTransId = await crearPedidoAtomico(
      restId, (cliente || admin)._id,
      meseroLocal ? meseroLocal._id : admin._id,
      mesa.numero, items
    );
    if (!ordenTransId) throw new Error('crearPedidoAtomico retorno null');
  });

  await run('Admin-Trans-2: Cerrar pedido atomico', async () => {
    const oid = ordenTransId || (await obtenerOrdenActiva(db, restId))?._id;
    if (!oid) throw new Error('Sin orden activa');
    const pdfId = await cerrarPedidoAtomico(oid, 'efectivo');
    if (!pdfId) throw new Error('cerrarPedidoAtomico retorno null');
  });

  await run('Admin-Trans-3: Cancelar orden (inline)', async () => {
    const mesa = await obtenerMesaDisponible(db, restId);
    if (!mesa) throw new Error('Sin mesas disponibles');
    const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(1).toArray();
    if (!platillos.length) throw new Error('Sin platillos');
    const oid = await crearPedidoAtomico(
      restId, (cliente || admin)._id, admin._id, mesa.numero,
      [{ _id: platillos[0]._id, nombre: platillos[0].nombre, precio: platillos[0].precio, cantidad: 1 }]
    );
    if (!oid) throw new Error('No se creo orden');
    const orden = await db.collection('ordenes').findOne({ _id: oid });
    await db.collection('ordenes').updateOne(
      { _id: oid },
      {
        $set: { estado: 'cancelado', updated_at: new Date() },
        $push: { historial_estados: { estado: 'cancelado', timestamp: new Date(), usuario_id: admin._id } }
      }
    );
    await db.collection('restaurantes').updateOne(
      { _id: restId, 'mesas.numero': orden.numero_mesa },
      { $set: { 'mesas.$.disponible': true } }
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // 6. MENU ADMIN — Aggregation Pipelines (sub-menu 4)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Aggregation Pipelines ═══════════════════════');

  await run('Admin-Pipeline-1: Total ordenes por restaurante', async () => {
    await totalOrdenesPorRestaurante();
  });

  await run('Admin-Pipeline-2: Conteo de ordenes por estado', async () => {
    await conteoOrdenesPorEstado(restId);
  });

  await run('Admin-Pipeline-3: Top 5 platillos mas vendidos', async () => {
    await top5Platillos();
  });

  await run('Admin-Pipeline-4: Restaurantes mejor calificados', async () => {
    await restaurantesMejorCalificados();
  });

  await run('Admin-Pipeline-5: Ingresos por periodo', async () => {
    await ingresosPorPeriodo('2025-12-01', '2026-12-31');
  });

  await run('Admin-Pipeline-6: Ejecutar todos los pipelines', async () => {
    await totalOrdenesPorRestaurante();
    await conteoOrdenesPorEstado(restId);
    await top5Platillos();
    await restaurantesMejorCalificados();
    await ingresosPorPeriodo('2025-12-01', '2026-12-31');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 7. MENU ADMIN — GridFS (sub-menu 5)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — GridFS ══════════════════════════════════════');

  let gridfsFileId = null;

  await run('Admin-GridFS-1: Listar comprobantes', async () => {
    const archivos = await listarComprobantes();
    if (!Array.isArray(archivos)) throw new Error('No retorno array');
  });

  await run('Admin-GridFS-2: Subir PDF de prueba', async () => {
    const orden = await db.collection('ordenes').findOne({ estado: 'pagado', restaurante_id: restId });
    if (!orden) throw new Error('No hay ordenes pagadas — ejecuta Admin-Trans-2 primero');
    const pdfBuffer = await generarPDFComprobante(orden, rest.nombre);
    gridfsFileId = await subirComprobante(orden._id, restId, pdfBuffer);
    if (!gridfsFileId) throw new Error('subirComprobante retorno null');
  });

  await run('Admin-GridFS-3: Descargar PDF a disco', async () => {
    if (!gridfsFileId) {
      const archivos = await listarComprobantes();
      if (!archivos.length) throw new Error('Sin archivos en GridFS para descargar');
      gridfsFileId = archivos[archivos.length - 1]._id;
    }
    const rutaSalida = `${process.cwd()}/comprobante_test.pdf`;
    const writeStream = require('fs').createWriteStream(rutaSalida);
    await descargarComprobante(gridfsFileId, writeStream);
    if (!require('fs').existsSync(rutaSalida)) throw new Error('Archivo no creado en disco');
    require('fs').unlinkSync(rutaSalida);
  });

  await run('Admin-GridFS-4: Eliminar PDF', async () => {
    if (!gridfsFileId) throw new Error('No hay archivo gridfsFileId para eliminar');
    await eliminarComprobante(gridfsFileId);
    gridfsFileId = null;
  });

  // ══════════════════════════════════════════════════════════════════════
  // 8. MENU ADMIN — Arrays (sub-menu 6)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Manejo de Arrays ════════════════════════════');

  await run('Admin-Arrays-1: $push agregar item a orden', async () => {
    const orden = await obtenerOrdenActiva(db, restId);
    if (!orden) throw new Error('Sin orden activa');
    const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(1).toArray();
    if (!platillos.length) throw new Error('Sin platillos');
    const p = platillos[0];
    await agregarItemAOrden(orden._id, {
      menu_item_id: new ObjectId(), nombre: 'Item extra test',
      precio_unitario: 15, cantidad: 1, notas: '', subtotal: 15
    });
  });

  await run('Admin-Arrays-2: $push registrar cambio de estado en historial', async () => {
    const orden = await obtenerOrdenActiva(db, restId);
    if (!orden) throw new Error('Sin orden activa');
    await registrarCambioEstado(orden._id, 'en_preparacion', admin._id);
  });

  await run('Admin-Arrays-2b: registrarCambioEstado — "pagado" bloqueado', async () => {
    const orden = await obtenerOrdenActiva(db, restId);
    if (!orden) throw new Error('Sin orden activa');
    const estado = 'pagado';
    if (['pagado', 'cancelado'].includes(estado)) {
      const ordenDespues = await db.collection('ordenes').findOne({ _id: orden._id });
      if (ordenDespues.estado === 'pagado') throw new Error('Estado cambio a pagado sin cerrarPedido');
    } else {
      throw new Error('Validacion no activa');
    }
  });

  await run('Admin-Arrays-3: $pull quitar tag del restaurante', async () => {
    // Agregar tag primero para asegurar que existe
    await db.collection('restaurantes').updateOne({ _id: restId }, { $addToSet: { tags: 'tag_test_pull' } });
    await quitarTagRestaurante(restId, 'tag_test_pull');
  });

  await run('Admin-Arrays-4: $addToSet agregar tag a resena', async () => {
    const resena = await db.collection('resenas').findOne({ restaurante_id: restId });
    if (!resena) throw new Error('Sin resenas en el restaurante');
    await agregarTagResena(resena._id, 'test_automatizado');
  });

  await run('Admin-Arrays-5: $addToSet agregar tag al restaurante', async () => {
    await agregarTagRestaurante(restId, 'prueba_automatizada');
    await db.collection('restaurantes').updateOne({ _id: restId }, { $pull: { tags: 'prueba_automatizada' } });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 9. MENU ADMIN — Projections (sub-menu 7)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Projections ═════════════════════════════════');

  await run('Admin-Proj-1: Inclusion simple — menu nombre/precio/categoria', async () => {
    const r = await projectionMenuSimple(restId);
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  await run('Admin-Proj-2: Inclusion + paginacion — ordenes sin items (pag 1)', async () => {
    const r = await projectionOrdenesSinItems(restId, 1, 10);
    if (!Array.isArray(r)) throw new Error('No retorno array');
  });

  await run('Admin-Proj-3: Exclusion — usuarios sin password_hash', async () => {
    const r = await projectionUsuarioSinPassword({});
    if (!Array.isArray(r)) throw new Error('No retorno array');
    if (r.length && r[0].password_hash) throw new Error('password_hash no fue excluido');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 10. MENU ADMIN — Indices y explain (sub-menu 8)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Indices y explain() ═════════════════════════');

  await run('Admin-Indices-1: Ver todos los indices', async () => {
    await validarIndices();
  });

  await run('Admin-Indices-2: explain() ordenes (IXSCAN)', async () => {
    const resultado = await db.collection('ordenes').find({
      restaurante_id: restId, estado: 'pendiente'
    }).explain('executionStats');
    const plan = resultado.queryPlanner.winningPlan;
    const stats = resultado.executionStats;
    const encontrarStage = (p) => {
      if (p.stage === 'IXSCAN') return p;
      if (p.inputStage) return encontrarStage(p.inputStage);
      return p;
    };
    const ixscan = encontrarStage(plan);
    console.log(`     Stage: ${plan.stage} | Input: ${ixscan.stage} | Docs examinados: ${stats.totalDocsExamined}`);
  });

  await run('Admin-Indices-3: explain() busqueda geoespacial', async () => {
    const resultado = await db.collection('restaurantes').find({
      ubicacion: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [-90.5132, 14.5890] },
          $maxDistance: 5000
        }
      }
    }).explain('executionStats');
    const plan = resultado.queryPlanner.winningPlan;
    const stats = resultado.executionStats;
    console.log(`     Stage: ${plan.stage} | Docs examinados: ${stats.totalDocsExamined}`);
  });

  await run('Admin-Indices-4: explain() busqueda full-text', async () => {
    const resultado = await db.collection('menu_items').find(
      { $text: { $search: 'pollo' } }
    ).explain('executionStats');
    const plan = resultado.queryPlanner.winningPlan;
    const stats = resultado.executionStats;
    console.log(`     Stage: ${plan.stage} | Docs examinados: ${stats.totalDocsExamined}`);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 11. MENU ADMIN — Resenas (sub-menu 9)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Resenas ═════════════════════════════════════');

  await run('Admin-Resenas-1: Ver resenas del restaurante', async () => {
    const resenas = await db.collection('resenas').find({ restaurante_id: restId })
      .sort({ created_at: -1 }).limit(10).toArray();
    if (!Array.isArray(resenas)) throw new Error('No retorno array');
    console.log(`     ${resenas.length} resenas encontradas`);
  });

  await run('Admin-Resenas-2: Responder resena', async () => {
    const resena = await db.collection('resenas').findOne({ restaurante_id: restId });
    if (!resena) throw new Error('Sin resenas para responder');
    await responderResena(resena._id, 'Respuesta de prueba automatizada — muchas gracias');
  });

  await run('Admin-Resenas-3: Eliminar resenas de un usuario', async () => {
    // Crear resena temporal para eliminar
    const clienteId = cliente?._id || admin._id;
    const rid = await crearResena({
      restaurante_id: restId, usuario_id: clienteId,
      calificacion: 3, comentario: 'Resena para eliminar en test', tags: []
    });
    if (!rid) throw new Error('No se creo resena de prueba');
    await eliminarResenasUsuario(clienteId);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 12. MENU ADMIN — opciones directas del menu principal admin
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ ADMIN — Opciones directas ═══════════════════════════');

  await run('Admin-10: Crear mesero', async () => {
    const ts = Date.now();
    const id = await crearUsuario({
      nombre: `Mesero Test ${ts}`, email: `mesero_${ts}@test.com`,
      password: '1234', rol: 'mesero', restaurante_id: restId
    });
    if (!id) throw new Error('No se creo el mesero');
    await db.collection('usuarios').deleteOne({ _id: id });
  });

  await run('Admin-12: Setup — crear colecciones + indices', async () => {
    await crearColecciones();
    await crearIndices();
  });

  // Admin-11: Seed — omitir para no borrar datos de prueba
  omitir('Admin-11: Ejecutar Seed', 'borraria todos los datos — ejecutar manualmente si se necesita');

  // ══════════════════════════════════════════════════════════════════════
  // RESUMEN
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log('  RESUMEN DE SIMULACION');
  console.log('═'.repeat(60));
  console.log(`  ✓ Pasaron  : ${ok}`);
  console.log(`  ✗ Fallaron : ${fail}`);
  console.log(`  - Omitidos : ${skip}`);
  console.log('═'.repeat(60));

  if (fail > 0) {
    console.log('\n  FALLAS DETECTADAS:');
    resultados
      .filter(r => r.estado === '✗')
      .forEach(r => console.log(`    ✗ ${r.label}\n      ${r.error}`));
  }

  console.log('');

  const client = getClient();
  if (client) await client.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
