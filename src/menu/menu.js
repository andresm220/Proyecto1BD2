const readline = require('readline');
const { conectar, getDb, getClient } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

// Importamos todos los modulos del sistema
const { crearRestaurante, crearUsuario, crearMenuItem, crearOrden, crearResena } = require('../crud/create');
const { restaurantesCercanos, menuPorCategoria, ordenesPorRestaurante, buscarPlatillos, lookupOrdenesConDetalle } = require('../crud/read');
const { actualizarEstadoOrden, deshabilitarCategoriaMenu, actualizarPrecioMenuItem, responderResena } = require('../crud/update');
const { eliminarMenuItem, eliminarResenasUsuario, cancelarOrden } = require('../crud/delete');
const { agregarItemAOrden, registrarCambioEstado, quitarTagRestaurante, agregarTagResena, agregarTagRestaurante } = require('../crud/arrays');
const { projectionMenuSimple, projectionOrdenesSinItems, projectionUsuarioSinPassword } = require('../crud/projections');
const { conteoOrdenesPorEstado, top5Platillos, restaurantesMejorCalificados, ingresosPorPeriodo } = require('../aggregations/pipelines');
const { crearPedidoAtomico } = require('../transactions/crearPedido');
const { cerrarPedidoAtomico, generarPDFComprobante } = require('../transactions/cerrarPedido');
const { subirComprobante, descargarComoBuffer, eliminarComprobante, listarComprobantes } = require('../gridfs/comprobantes');
const { crearColecciones } = require('../collections/createCollections');
const { crearIndices, validarIndices } = require('../collections/createIndexes');
const { ejecutarSeed } = require('../seed/seed');

// readline para input en terminal
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const preguntar = (msg) => new Promise(res => {
  try { rl.question(msg, res); } catch (err) { res(''); }
});

// =====================================================
// SESION — usuario y restaurante actuales
// =====================================================
let sesion = { usuario: null, restaurante: null };

// =====================================================
// LOGIN / REGISTRO
// =====================================================

async function pantallaLogin() {
  const db = getDb();

  while (true) {
    console.log('\n====================================================');
    console.log('  Sistema de Gestion de Reservas y Pedidos');
    console.log('  Restaurante Fisico — MongoDB');
    console.log('  CC3089 Base de Datos 2 | UVG 2026');
    console.log('====================================================');
    console.log('\n  1. Iniciar sesion');
    console.log('  2. Registrarse como cliente');
    console.log('  3. Ver usuarios disponibles (demo)');
    console.log('  0. Salir');

    const op = (await preguntar('\n  Opcion: ')).trim();

    switch (op) {
      case '1': {
        const email = (await preguntar('  Email: ')).trim();
        const password = (await preguntar('  Contraseña: ')).trim();

        const usuario = await db.collection('usuarios').findOne({ email });
        if (!usuario) {
          console.log('  No se encontro un usuario con ese email.');
          break;
        }
        // bcrypt.compare compara la contraseña en texto plano contra el hash almacenado
        const coincide = await bcrypt.compare(password, usuario.password_hash);
        if (!coincide) {
          console.log('  Contraseña incorrecta.');
          break;
        }

        sesion.usuario = usuario;

        // Si es mesero o admin, cargar su restaurante
        if (usuario.restaurante_id) {
          sesion.restaurante = await db.collection('restaurantes').findOne({ _id: usuario.restaurante_id });
        }

        console.log(`\n  Bienvenido, ${usuario.nombre} (${usuario.rol})`);
        if (sesion.restaurante) {
          console.log(`  Restaurante: ${sesion.restaurante.nombre}`);
        }
        return true;  // login exitoso
      }
      case '2': {
        const nombre = (await preguntar('  Nombre completo: ')).trim();
        const email = (await preguntar('  Email: ')).trim();
        const password = (await preguntar('  Contraseña: ')).trim();

        const id = await crearUsuario({ nombre, email, password, rol: 'cliente' });
        if (id) {
          sesion.usuario = await db.collection('usuarios').findOne({ _id: id });
          console.log(`\n  Registro exitoso. Bienvenido, ${nombre}!`);
          return true;
        }
        break;
      }
      case '3': {
        // Listar usuarios agrupados por rol para demo
        const usuarios = await db.collection('usuarios').find({}, {
          projection: { nombre: 1, email: 1, rol: 1 }
        }).toArray();

        const roles = ['admin', 'mesero', 'cliente'];
        for (const rol of roles) {
          const delRol = usuarios.filter(u => u.rol === rol);
          console.log(`\n  --- ${rol.toUpperCase()} (${delRol.length}) ---`);
          delRol.forEach(u => console.log(`    ${u.email} | ${u.nombre}`));
        }
        console.log('\n  Contraseña de todos los usuarios demo: 1234');
        break;
      }
      case '0': return false;  // salir
      default: console.log('  Opcion invalida');
    }
  }
}

// =====================================================
// HELPERS
// =====================================================

// Seleccionar restaurante: admin/mesero usa el suyo, cliente elige
async function obtenerRestaurante() {
  if (sesion.restaurante && sesion.usuario.rol !== 'cliente') {
    return sesion.restaurante;
  }
  const db = getDb();
  const restaurantes = await db.collection('restaurantes').find({}, { projection: { nombre: 1 } }).toArray();
  if (restaurantes.length === 0) {
    console.log('  No hay restaurantes. Ejecuta el seed primero.');
    return null;
  }
  console.log('\n  Restaurantes disponibles:');
  restaurantes.forEach((r, i) => console.log(`    ${i + 1}. ${r.nombre}`));
  const opcion = await preguntar('  Selecciona numero: ');
  const idx = parseInt(opcion) - 1;
  if (idx < 0 || idx >= restaurantes.length) {
    console.log('  Opcion invalida');
    return null;
  }
  return restaurantes[idx];
}

// Seleccionar orden con nombre de restaurante
async function obtenerOrden(filtro = {}) {
  const db = getDb();
  // Si es mesero/admin, filtrar solo ordenes de su restaurante
  if (sesion.restaurante && sesion.usuario.rol !== 'cliente') {
    filtro.restaurante_id = sesion.restaurante._id;
  }
  const ordenes = await db.collection('ordenes').aggregate([
    { $match: filtro },
    { $limit: 10 },
    { $lookup: { from: 'restaurantes', localField: 'restaurante_id', foreignField: '_id', as: 'rest' } },
    { $project: { numero_mesa: 1, estado: 1, total: 1, restaurante_nombre: { $arrayElemAt: ['$rest.nombre', 0] } } }
  ]).toArray();
  if (ordenes.length === 0) {
    console.log('  No hay ordenes disponibles con ese filtro.');
    return null;
  }
  console.log('\n  Ordenes disponibles:');
  ordenes.forEach((o, i) => console.log(`    ${i + 1}. ${o.restaurante_nombre} | Mesa ${o.numero_mesa} | ${o.estado} | Q${o.total}`));
  const opcion = await preguntar('  Selecciona numero: ');
  const idx = parseInt(opcion) - 1;
  if (idx < 0 || idx >= ordenes.length) {
    console.log('  Opcion invalida');
    return null;
  }
  return await db.collection('ordenes').findOne({ _id: ordenes[idx]._id });
}

// =====================================================
// MENU CLIENTE
// =====================================================
async function menuCliente() {
  const db = getDb();

  while (true) {
    console.log(`\n--- MENU CLIENTE — ${sesion.usuario.nombre} ---`);
    console.log('  1. Buscar restaurantes cercanos');
    console.log('  2. Ver menu de un restaurante');
    console.log('  3. Buscar platillos (full-text)');
    console.log('  4. Hacer pedido');
    console.log('  5. Dejar resena');
    console.log('  6. Ver mis ordenes');
    console.log('  0. Cerrar sesion');

    const op = (await preguntar('\n  Opcion: ')).trim();

    try {
      switch (op) {
        case '1': {
          const lat = parseFloat(await preguntar('  Latitud (default 14.5890): ')) || 14.5890;
          const lng = parseFloat(await preguntar('  Longitud (default -90.5132): ')) || -90.5132;
          const dist = parseInt(await preguntar('  Distancia en metros (default 5000): ')) || 5000;
          await restaurantesCercanos(lat, lng, dist);
          break;
        }
        case '2': {
          const rest = await obtenerRestaurante();
          if (!rest) break;
          const cat = await preguntar('  Categoria (entrada/plato_fuerte/postre/bebida): ');
          await menuPorCategoria(rest._id, cat.trim());
          break;
        }
        case '3': {
          const texto = await preguntar('  Buscar platillo: ');
          await buscarPlatillos(texto.trim());
          break;
        }
        case '4': {
          const rest = await obtenerRestaurante();
          if (!rest) break;
          // Buscar un mesero de ese restaurante
          const mesero = await db.collection('usuarios').findOne({ rol: 'mesero', restaurante_id: rest._id });
          if (!mesero) {
            // Si no hay mesero asignado, usar cualquiera
            const anyMesero = await db.collection('usuarios').findOne({ rol: 'mesero' });
            if (!anyMesero) { console.log('  No hay meseros registrados'); break; }
          }
          const meseroId = mesero ? mesero._id : (await db.collection('usuarios').findOne({ rol: 'mesero' }))._id;

          const platillos = await db.collection('menu_items').find({
            restaurante_id: rest._id, disponible: true
          }).toArray();
          if (platillos.length === 0) { console.log('  No hay platillos disponibles'); break; }

          console.log('\n  Platillos disponibles:');
          platillos.forEach((p, i) => console.log(`    ${i + 1}. ${p.nombre} | Q${p.precio} | ${p.categoria}`));
          const seleccion = await preguntar('  Numeros separados por coma (ej: 1,3,5): ');
          const indices = seleccion.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < platillos.length);
          if (indices.length === 0) { console.log('  Seleccion invalida'); break; }

          const items = indices.map(i => ({
            _id: platillos[i]._id, nombre: platillos[i].nombre,
            precio: platillos[i].precio, cantidad: 1
          }));

          const mesa = parseInt(await preguntar('  Numero de mesa: ')) || 1;
          await crearOrden(rest._id, sesion.usuario._id, meseroId, mesa, items);
          break;
        }
        case '5': {
          const rest = await obtenerRestaurante();
          if (!rest) break;
          const calificacion = parseInt(await preguntar('  Calificacion (1-5): '));
          const comentario = await preguntar('  Comentario: ');
          await crearResena({
            restaurante_id: rest._id, usuario_id: sesion.usuario._id,
            calificacion, comentario, tags: []
          });
          break;
        }
        case '6': {
          const misOrdenes = await db.collection('ordenes').aggregate([
            { $match: { usuario_id: sesion.usuario._id } },
            { $lookup: { from: 'restaurantes', localField: 'restaurante_id', foreignField: '_id', as: 'rest' } },
            { $project: { numero_mesa: 1, estado: 1, total: 1, created_at: 1, restaurante: { $arrayElemAt: ['$rest.nombre', 0] } } },
            { $sort: { created_at: -1 } },
            { $limit: 10 }
          ]).toArray();

          if (misOrdenes.length === 0) {
            console.log('  No tienes ordenes registradas.');
          } else {
            console.log(`\n  Mis ordenes (${misOrdenes.length}):`);
            misOrdenes.forEach((o, i) => {
              console.log(`    ${i + 1}. ${o.restaurante} | Mesa ${o.numero_mesa} | ${o.estado} | Q${o.total} | ${o.created_at.toLocaleDateString()}`);
            });
          }
          break;
        }
        case '0': return;
        default: console.log('  Opcion invalida');
      }
    } catch (err) {
      manejarError(err, 'menu cliente');
    }
  }
}

// =====================================================
// MENU MESERO
// =====================================================
async function menuMesero() {
  const db = getDb();
  const restId = sesion.restaurante._id;

  while (true) {
    console.log(`\n--- MENU MESERO — ${sesion.restaurante.nombre} ---`);
    console.log('  1. Ver ordenes del restaurante');
    console.log('  2. Actualizar estado de orden');
    console.log('  3. Crear pedido (orden + ocupar mesa)');
    console.log('  4. Cerrar pedido (pagar + PDF + liberar mesa)');
    console.log('  5. Ver menu del restaurante');
    console.log('  6. Agregar item a orden existente ($push)');
    console.log('  7. Registrar cambio de estado en historial ($push)');
    console.log('  0. Cerrar sesion');

    const op = (await preguntar('\n  Opcion: ')).trim();

    try {
      switch (op) {
        case '1': {
          const pagina = parseInt(await preguntar('  Pagina (default 1): ')) || 1;
          await ordenesPorRestaurante(restId, pagina, 10);
          break;
        }
        case '2': {
          const orden = await obtenerOrden();
          if (!orden) break;
          const estado = await preguntar('  Nuevo estado (pendiente/en_preparacion/servido/pagado/cancelado): ');
          await actualizarEstadoOrden(orden._id, estado.trim(), sesion.usuario._id);
          break;
        }
        case '3': {
          const cliente = await db.collection('usuarios').findOne({ rol: 'cliente' });
          const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).toArray();
          if (platillos.length === 0) { console.log('  No hay platillos en el menu'); break; }
          console.log('\n  Platillos:');
          platillos.forEach((p, i) => console.log(`    ${i + 1}. ${p.nombre} | Q${p.precio}`));
          const seleccion = await preguntar('  Numeros separados por coma (ej: 1,3): ');
          const indices = seleccion.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < platillos.length);
          if (indices.length === 0) { console.log('  Seleccion invalida'); break; }
          const mesa = parseInt(await preguntar('  Numero de mesa: ')) || 1;
          // Liberar mesa por si estaba ocupada
          await db.collection('restaurantes').updateOne(
            { _id: restId, 'mesas.numero': mesa },
            { $set: { 'mesas.$.disponible': true } }
          );
          const items = indices.map(i => ({
            _id: platillos[i]._id, nombre: platillos[i].nombre,
            precio: platillos[i].precio, cantidad: 1
          }));
          await crearPedidoAtomico(restId, cliente._id, sesion.usuario._id, mesa, items);
          break;
        }
        case '4': {
          const orden = await obtenerOrden({ estado: { $nin: ['pagado', 'cancelado'] } });
          if (!orden) break;
          const metodo = (await preguntar('  Metodo de pago (efectivo/tarjeta/transferencia): ')).trim() || 'tarjeta';
          await cerrarPedidoAtomico(orden._id, metodo);
          break;
        }
        case '5': {
          const cat = await preguntar('  Categoria (entrada/plato_fuerte/postre/bebida): ');
          await menuPorCategoria(restId, cat.trim());
          break;
        }
        case '6': {
          const orden = await obtenerOrden();
          if (!orden) break;
          const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).toArray();
          platillos.forEach((p, i) => console.log(`    ${i + 1}. ${p.nombre} | Q${p.precio}`));
          const idx = parseInt(await preguntar('  Selecciona platillo: ')) - 1;
          if (idx < 0 || idx >= platillos.length) break;
          const p = platillos[idx];
          await agregarItemAOrden(orden._id, {
            menu_item_id: p._id, nombre: p.nombre,
            precio_unitario: p.precio, cantidad: 1, notas: '', subtotal: p.precio
          });
          break;
        }
        case '7': {
          const orden = await obtenerOrden();
          if (!orden) break;
          const estado = (await preguntar('  Estado a registrar: ')).trim() || 'en_preparacion';
          await registrarCambioEstado(orden._id, estado, sesion.usuario._id);
          break;
        }
        case '0': return;
        default: console.log('  Opcion invalida');
      }
    } catch (err) {
      manejarError(err, 'menu mesero');
    }
  }
}

// =====================================================
// SUBMENUS ADMIN
// =====================================================

async function adminMenuItems() {
  const db = getDb();
  const restId = sesion.restaurante._id;

  while (true) {
    console.log('\n  --- GESTION DEL MENU ---');
    console.log('  1. Ver menu por categoria');
    console.log('  2. Crear item');
    console.log('  3. Actualizar precio');
    console.log('  4. Deshabilitar categoria completa');
    console.log('  5. Eliminar item');
    console.log('  0. Volver');

    const op = (await preguntar('  Opcion: ')).trim();

    try {
      switch (op) {
        case '1': {
          const cat = (await preguntar('  Categoria (entrada/plato_fuerte/postre/bebida): ')).trim();
          await menuPorCategoria(restId, cat);
          break;
        }
        case '2': {
          const nombre = await preguntar('  Nombre del platillo: ');
          const categoria = (await preguntar('  Categoria (entrada/plato_fuerte/postre/bebida): ')).trim();
          const precio = parseFloat(await preguntar('  Precio: '));
          await crearMenuItem({ restaurante_id: restId, nombre: nombre.trim(), categoria, precio });
          break;
        }
        case '3': {
          const items = await db.collection('menu_items').find({ restaurante_id: restId })
            .project({ nombre: 1, precio: 1 }).toArray();
          items.forEach((it, i) => console.log(`    ${i + 1}. ${it.nombre}: Q${it.precio}`));
          const idx = parseInt(await preguntar('  Selecciona numero: ')) - 1;
          if (idx < 0 || idx >= items.length) break;
          const precio = parseFloat(await preguntar('  Nuevo precio: '));
          await actualizarPrecioMenuItem(items[idx]._id, precio);
          break;
        }
        case '4': {
          const cat = (await preguntar('  Categoria a deshabilitar: ')).trim();
          await deshabilitarCategoriaMenu(restId, cat);
          break;
        }
        case '5': {
          const items = await db.collection('menu_items').find({ restaurante_id: restId })
            .project({ nombre: 1, precio: 1 }).toArray();
          items.forEach((it, i) => console.log(`    ${i + 1}. ${it.nombre}: Q${it.precio}`));
          const idx = parseInt(await preguntar('  Selecciona numero a eliminar: ')) - 1;
          if (idx < 0 || idx >= items.length) break;
          await eliminarMenuItem(items[idx]._id);
          break;
        }
        case '0': return;
        default: console.log('  Opcion invalida');
      }
    } catch (err) {
      manejarError(err, 'gestion del menu');
    }
  }
}

async function adminOrdenes() {
  const db = getDb();
  const restId = sesion.restaurante._id;

  while (true) {
    console.log('\n  --- ORDENES DEL RESTAURANTE ---');
    console.log('  1. Ver ordenes paginadas');
    console.log('  2. Actualizar estado de orden');
    console.log('  3. Cancelar orden');
    console.log('  4. Lookup ordenes con detalle');
    console.log('  0. Volver');

    const op = (await preguntar('  Opcion: ')).trim();

    try {
      switch (op) {
        case '1': {
          const pagina = parseInt(await preguntar('  Pagina (default 1): ')) || 1;
          await ordenesPorRestaurante(restId, pagina, 10);
          break;
        }
        case '2': {
          const orden = await obtenerOrden();
          if (!orden) break;
          const estado = (await preguntar('  Nuevo estado (pendiente/en_preparacion/servido/pagado/cancelado): ')).trim();
          await actualizarEstadoOrden(orden._id, estado, sesion.usuario._id);
          break;
        }
        case '3': {
          const orden = await obtenerOrden();
          if (!orden) break;
          const confirmar = await preguntar('  Seguro que deseas cancelar esta orden? (s/n): ');
          if (confirmar.trim().toLowerCase() === 's') await cancelarOrden(orden._id);
          break;
        }
        case '4': {
          await lookupOrdenesConDetalle(restId);
          break;
        }
        case '0': return;
        default: console.log('  Opcion invalida');
      }
    } catch (err) {
      manejarError(err, 'ordenes del restaurante');
    }
  }
}

async function adminTransacciones() {
  const db = getDb();
  const restId = sesion.restaurante._id;

  console.log('\n  --- TRANSACCIONES MULTI-DOCUMENTO ---');
  console.log('  1. Crear pedido atomico (orden + ocupar mesa)');
  console.log('  2. Cerrar pedido atomico (pagar + PDF + liberar mesa)');
  console.log('  0. Volver');

  const op = (await preguntar('  Opcion: ')).trim();

  try {
    switch (op) {
      case '1': {
        const cliente = await db.collection('usuarios').findOne({ rol: 'cliente' });
        const mesero = await db.collection('usuarios').findOne({ rol: 'mesero', restaurante_id: restId });
        const platillos = await db.collection('menu_items').find({ restaurante_id: restId, disponible: true }).limit(5).toArray();
        if (platillos.length === 0) { console.log('  No hay platillos'); break; }
        console.log('\n  Platillos:');
        platillos.forEach((p, i) => console.log(`    ${i + 1}. ${p.nombre} | Q${p.precio}`));
        const seleccion = await preguntar('  Numeros separados por coma: ');
        const indices = seleccion.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < platillos.length);
        if (indices.length === 0) { console.log('  Seleccion invalida'); break; }
        const mesa = parseInt(await preguntar('  Numero de mesa: ')) || 1;
        await db.collection('restaurantes').updateOne(
          { _id: restId, 'mesas.numero': mesa },
          { $set: { 'mesas.$.disponible': true } }
        );
        const items = indices.map(i => ({
          _id: platillos[i]._id, nombre: platillos[i].nombre,
          precio: platillos[i].precio, cantidad: 1
        }));
        const meseroId = mesero ? mesero._id : sesion.usuario._id;
        await crearPedidoAtomico(restId, cliente._id, meseroId, mesa, items);
        break;
      }
      case '2': {
        const orden = await obtenerOrden({ estado: { $nin: ['pagado', 'cancelado'] } });
        if (!orden) break;
        const metodo = (await preguntar('  Metodo de pago (efectivo/tarjeta/transferencia): ')).trim() || 'tarjeta';
        await cerrarPedidoAtomico(orden._id, metodo);
        break;
      }
      case '0': return;
    }
  } catch (err) {
    manejarError(err, 'transaccion');
  }
}

async function adminPipelines() {
  const db = getDb();
  const restId = sesion.restaurante._id;

  console.log('\n  --- AGGREGATION PIPELINES ---');
  console.log('  1. Simple: Conteo de ordenes por estado');
  console.log('  2. Compleja: Top 5 platillos mas vendidos');
  console.log('  3. Compleja: Restaurantes mejor calificados');
  console.log('  4. Compleja: Ingresos por restaurante en periodo');
  console.log('  5. Ejecutar todos los pipelines');
  console.log('  0. Volver');

  const op = (await preguntar('  Opcion: ')).trim();

  try {
    switch (op) {
      case '1': await conteoOrdenesPorEstado(restId); break;
      case '2': await top5Platillos(); break;
      case '3': await restaurantesMejorCalificados(); break;
      case '4': {
        const inicio = (await preguntar('  Fecha inicio (YYYY-MM-DD, default 2025-12-01): ')).trim() || '2025-12-01';
        const fin = (await preguntar('  Fecha fin (YYYY-MM-DD, default 2026-12-31): ')).trim() || '2026-12-31';
        await ingresosPorPeriodo(inicio, fin);
        break;
      }
      case '5': {
        await conteoOrdenesPorEstado(restId);
        console.log('');
        await top5Platillos();
        console.log('');
        await restaurantesMejorCalificados();
        console.log('');
        await ingresosPorPeriodo('2025-12-01', '2026-12-31');
        break;
      }
      case '0': return;
    }
  } catch (err) {
    manejarError(err, 'aggregation pipeline');
  }
}

async function adminGridFS() {
  const db = getDb();

  console.log('\n  --- GRIDFS (Comprobantes PDF) ---');
  console.log('  1. Listar comprobantes en GridFS');
  console.log('  2. Subir PDF de prueba');
  console.log('  3. Descargar PDF como buffer');
  console.log('  4. Eliminar PDF');
  console.log('  0. Volver');

  const op = (await preguntar('  Opcion: ')).trim();

  try {
    switch (op) {
      case '1': {
        await listarComprobantes();
        break;
      }
      case '2': {
        const orden = await db.collection('ordenes').findOne({
          estado: 'pagado', restaurante_id: sesion.restaurante._id
        });
        if (!orden) { console.log('  No hay ordenes pagadas en tu restaurante'); break; }
        const pdfBuffer = await generarPDFComprobante(orden, sesion.restaurante.nombre);
        await subirComprobante(orden._id, orden.restaurante_id, pdfBuffer);
        break;
      }
      case '3': {
        const archivos = await listarComprobantes();
        if (archivos.length === 0) break;
        const idx = parseInt(await preguntar('  Selecciona numero: ')) - 1;
        if (idx < 0 || idx >= archivos.length) break;
        const buffer = await descargarComoBuffer(archivos[idx]._id);
        if (buffer) {
          const esPDF = buffer.toString('utf8', 0, 5) === '%PDF-';
          console.log('  Es PDF valido:', esPDF ? 'SI' : 'NO');
        }
        break;
      }
      case '4': {
        const archivos = await listarComprobantes();
        if (archivos.length === 0) break;
        const idx = parseInt(await preguntar('  Selecciona numero a eliminar: ')) - 1;
        if (idx < 0 || idx >= archivos.length) break;
        await eliminarComprobante(archivos[idx]._id);
        break;
      }
      case '0': return;
    }
  } catch (err) {
    manejarError(err, 'operacion GridFS');
  }
}

async function adminArrays() {
  const db = getDb();
  const restId = sesion.restaurante._id;

  console.log('\n  --- MANEJO DE ARRAYS ---');
  console.log('  1. $push — Agregar item a orden');
  console.log('  2. $push — Registrar cambio de estado en historial');
  console.log('  3. $pull — Quitar tag del restaurante');
  console.log('  4. $addToSet — Agregar tag a resena (sin duplicar)');
  console.log('  5. $addToSet — Agregar tag al restaurante (sin duplicar)');
  console.log('  0. Volver');

  const op = (await preguntar('  Opcion: ')).trim();

  try {
    switch (op) {
      case '1': {
        const orden = await obtenerOrden();
        if (!orden) break;
        const nombre = (await preguntar('  Nombre del item: ')).trim() || 'Item extra';
        const precio = parseFloat(await preguntar('  Precio: ')) || 25;
        await agregarItemAOrden(orden._id, {
          menu_item_id: new ObjectId(), nombre,
          precio_unitario: precio, cantidad: 1, notas: '', subtotal: precio
        });
        break;
      }
      case '2': {
        const orden = await obtenerOrden();
        if (!orden) break;
        const estado = (await preguntar('  Estado: ')).trim() || 'en_preparacion';
        await registrarCambioEstado(orden._id, estado, sesion.usuario._id);
        break;
      }
      case '3': {
        const restCompleto = await db.collection('restaurantes').findOne({ _id: restId });
        console.log('  Tags actuales:', restCompleto.tags);
        const tag = (await preguntar('  Tag a eliminar: ')).trim();
        await quitarTagRestaurante(restId, tag);
        break;
      }
      case '4': {
        const resena = await db.collection('resenas').findOne({ restaurante_id: restId });
        if (!resena) { console.log('  No hay resenas en tu restaurante'); break; }
        console.log('  Tags actuales:', resena.tags);
        const tag = (await preguntar('  Tag a agregar: ')).trim();
        await agregarTagResena(resena._id, tag);
        break;
      }
      case '5': {
        const restCompleto = await db.collection('restaurantes').findOne({ _id: restId });
        console.log('  Tags actuales:', restCompleto.tags);
        const tag = (await preguntar('  Tag a agregar: ')).trim();
        await agregarTagRestaurante(restId, tag);
        break;
      }
      case '0': return;
    }
  } catch (err) {
    manejarError(err, 'operacion de arrays');
  }
}

async function adminProjections() {
  const restId = sesion.restaurante._id;

  console.log('\n  --- PROJECTIONS ---');
  console.log('  1. Inclusion simple — menu solo nombre/precio/categoria');
  console.log('  2. Inclusion + paginacion — ordenes sin items');
  console.log('  3. Exclusion — usuarios sin password_hash');
  console.log('  0. Volver');

  const op = (await preguntar('  Opcion: ')).trim();

  try {
    switch (op) {
      case '1': await projectionMenuSimple(restId); break;
      case '2': {
        const pagina = parseInt(await preguntar('  Pagina (default 1): ')) || 1;
        await projectionOrdenesSinItems(restId, pagina, 10);
        break;
      }
      case '3': {
        const rol = (await preguntar('  Filtrar por rol (cliente/mesero/admin/todos): ')).trim() || 'todos';
        const filtro = rol === 'todos' ? {} : { rol };
        await projectionUsuarioSinPassword(filtro);
        break;
      }
      case '0': return;
    }
  } catch (err) {
    manejarError(err, 'projections');
  }
}

async function adminIndices() {
  const db = getDb();

  console.log('\n  --- INDICES Y EXPLAIN ---');
  console.log('  1. Ver todos los indices creados');
  console.log('  2. Validar con explain() que ordenes use IXSCAN');
  console.log('  3. Validar con explain() busqueda geoespacial');
  console.log('  4. Validar con explain() busqueda full-text');
  console.log('  0. Volver');

  const op = (await preguntar('  Opcion: ')).trim();

  try {
    const encontrarStage = (p) => {
      if (p.stage === 'IXSCAN') return p;
      if (p.inputStage) return encontrarStage(p.inputStage);
      return p;
    };

    switch (op) {
      case '1': await validarIndices(); break;
      case '2': {
        const resultado = await db.collection('ordenes').find({
          restaurante_id: sesion.restaurante._id, estado: 'pendiente'
        }).explain('executionStats');
        const plan = resultado.queryPlanner.winningPlan;
        const stats = resultado.executionStats;
        const ixscan = encontrarStage(plan);
        console.log('\n  Resultado explain() para ordenes:');
        console.log('  Stage principal:', plan.stage);
        console.log('  Input stage:', ixscan.stage, ixscan.stage === 'IXSCAN' ? '(USA INDICE)' : '(COLLSCAN)');
        if (ixscan.indexName) console.log('  Indice usado:', ixscan.indexName);
        console.log('  Docs examinados:', stats.totalDocsExamined);
        console.log('  Docs retornados:', stats.nReturned);
        break;
      }
      case '3': {
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
        console.log('\n  Resultado explain() para $nearSphere:');
        console.log('  Stage:', plan.stage);
        if (plan.inputStage) console.log('  Input stage:', plan.inputStage.stage);
        console.log('  Docs examinados:', stats.totalDocsExamined);
        console.log('  Docs retornados:', stats.nReturned);
        break;
      }
      case '4': {
        const resultado = await db.collection('menu_items').find(
          { $text: { $search: 'pollo' } }
        ).explain('executionStats');
        const plan = resultado.queryPlanner.winningPlan;
        const stats = resultado.executionStats;
        console.log('\n  Resultado explain() para $text:');
        console.log('  Stage:', plan.stage);
        if (plan.inputStage) console.log('  Input stage:', plan.inputStage.stage);
        console.log('  Docs examinados:', stats.totalDocsExamined);
        console.log('  Docs retornados:', stats.nReturned);
        break;
      }
      case '0': return;
    }
  } catch (err) {
    manejarError(err, 'indices y explain');
  }
}

async function adminResenas() {
  const db = getDb();
  const restId = sesion.restaurante._id;

  console.log('\n  --- RESENAS DEL RESTAURANTE ---');
  console.log('  1. Ver resenas');
  console.log('  2. Responder resena');
  console.log('  3. Eliminar resenas de un usuario');
  console.log('  0. Volver');

  const op = (await preguntar('  Opcion: ')).trim();

  try {
    switch (op) {
      case '1': {
        const resenas = await db.collection('resenas').find({ restaurante_id: restId })
          .sort({ created_at: -1 }).limit(10).toArray();
        if (resenas.length === 0) { console.log('  No hay resenas'); break; }
        console.log(`\n  Resenas (${resenas.length}):`);
        resenas.forEach((r, i) => {
          console.log(`    ${i + 1}. ${'★'.repeat(r.calificacion)}${'☆'.repeat(5 - r.calificacion)} | ${r.comentario.substring(0, 60)}...`);
          if (r.respuesta_restaurante) {
            console.log(`       Respuesta: ${r.respuesta_restaurante.texto}`);
          }
        });
        break;
      }
      case '2': {
        const resenas = await db.collection('resenas').find({ restaurante_id: restId })
          .sort({ created_at: -1 }).limit(10).toArray();
        if (resenas.length === 0) { console.log('  No hay resenas'); break; }
        resenas.forEach((r, i) => {
          console.log(`    ${i + 1}. ${'★'.repeat(r.calificacion)} | ${r.comentario.substring(0, 60)}...`);
        });
        const idx = parseInt(await preguntar('  Selecciona resena a responder: ')) - 1;
        if (idx < 0 || idx >= resenas.length) break;
        const respuesta = await preguntar('  Respuesta: ');
        await responderResena(resenas[idx]._id, respuesta.trim());
        break;
      }
      case '3': {
        const usuarios = await db.collection('usuarios').find({ rol: 'cliente' })
          .project({ nombre: 1 }).limit(5).toArray();
        usuarios.forEach((u, i) => console.log(`    ${i + 1}. ${u.nombre}`));
        const idx = parseInt(await preguntar('  Selecciona usuario: ')) - 1;
        if (idx < 0 || idx >= usuarios.length) break;
        await eliminarResenasUsuario(usuarios[idx]._id);
        break;
      }
      case '0': return;
    }
  } catch (err) {
    manejarError(err, 'resenas');
  }
}

// =====================================================
// MENU ADMIN
// =====================================================
async function menuAdmin() {
  while (true) {
    console.log(`\n--- MENU ADMIN — ${sesion.restaurante.nombre} ---`);
    console.log('  1.  Gestion del Menu (CRUD items)');
    console.log('  2.  Ordenes del restaurante');
    console.log('  3.  Transacciones (crear/cerrar pedido)');
    console.log('  4.  Aggregation Pipelines (reportes)');
    console.log('  5.  GridFS (comprobantes PDF)');
    console.log('  6.  Manejo de Arrays ($push, $pull, $addToSet)');
    console.log('  7.  Projections');
    console.log('  8.  Indices y explain()');
    console.log('  9.  Resenas del restaurante');
    console.log('  10. Ejecutar Seed (regenerar datos)');
    console.log('  11. Setup (crear colecciones + indices)');
    console.log('  0.  Cerrar sesion');

    const op = (await preguntar('\n  Opcion: ')).trim();

    try {
      switch (op) {
        case '1': await adminMenuItems(); break;
        case '2': await adminOrdenes(); break;
        case '3': await adminTransacciones(); break;
        case '4': await adminPipelines(); break;
        case '5': await adminGridFS(); break;
        case '6': await adminArrays(); break;
        case '7': await adminProjections(); break;
        case '8': await adminIndices(); break;
        case '9': await adminResenas(); break;
        case '10': {
          console.log('\n  Esto borrara todos los datos y los reemplazara con datos de prueba.');
          const confirmar = await preguntar('  Continuar? (s/n): ');
          if (confirmar.trim().toLowerCase() === 's') {
            await ejecutarSeed();
            // Recargar restaurante de la sesion
            sesion.restaurante = await getDb().collection('restaurantes').findOne({ _id: sesion.restaurante._id });
          }
          break;
        }
        case '11': {
          await crearColecciones();
          await crearIndices();
          break;
        }
        case '0': return;
        default: console.log('  Opcion invalida');
      }
    } catch (err) {
      manejarError(err, 'menu admin');
    }
  }
}

// =====================================================
// MAIN — Login → Menu segun rol
// =====================================================
async function main() {
  await conectar();

  while (true) {
    const loggedIn = await pantallaLogin();
    if (!loggedIn) break;  // eligio salir

    // Redirigir al menu segun el rol del usuario
    switch (sesion.usuario.rol) {
      case 'cliente': await menuCliente(); break;
      case 'mesero': await menuMesero(); break;
      case 'admin': await menuAdmin(); break;
    }

    // Al cerrar sesion, limpiar
    console.log(`\n  Sesion cerrada (${sesion.usuario.nombre})`);
    sesion = { usuario: null, restaurante: null };
  }

  console.log('\n  Cerrando conexion...');
  const client = getClient();
  if (client) await client.close();
  rl.close();
  console.log('  Hasta luego!');
  process.exit(0);
}

main().catch(console.error);
