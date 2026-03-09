const { getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

// =====================================================
// CREATE — Funciones para insertar documentos
// =====================================================

/**
 * crearRestaurante(datos) — registra un nuevo restaurante con mesas embebidas.
 * @param {Object} datos - { nombre, descripcion, categoria, telefono, email, lat, lng, direccion, numMesas, tags }
 * @returns {ObjectId|null} - El _id del restaurante creado, o null si falla
 */
async function crearRestaurante(datos) {
  try {
    const db = getDb();
    // Generamos el array de mesas embebidas según la cantidad indicada
    const mesas = Array.from({ length: datos.numMesas || 5 }, (_, i) => ({
      numero: i + 1,
      capacidad: [2, 4, 6, 8][i % 4],  // alterna entre 2, 4, 6, 8
      disponible: true
    }));

    const restaurante = {
      nombre: datos.nombre,
      descripcion: datos.descripcion || '',
      categoria: datos.categoria,
      telefono: datos.telefono || '',
      email: datos.email || '',
      // ubicacion en formato GeoJSON Point — [longitud, latitud]
      ubicacion: {
        type: 'Point',
        coordinates: [datos.lng, datos.lat]
      },
      direccion: datos.direccion || '',
      horario: {
        lunes: { apertura: '08:00', cierre: '22:00' },
        martes: { apertura: '08:00', cierre: '22:00' },
        miercoles: { apertura: '08:00', cierre: '22:00' },
        jueves: { apertura: '08:00', cierre: '22:00' },
        viernes: { apertura: '08:00', cierre: '23:00' },
        sabado: { apertura: '09:00', cierre: '23:00' },
        domingo: { apertura: '09:00', cierre: '21:00' }
      },
      mesas,
      tags: datos.tags || [],
      calificacion_promedio: 0,
      activo: true,
      created_at: new Date()
    };

    const result = await db.collection('restaurantes').insertOne(restaurante);
    console.log('Restaurante creado con _id:', result.insertedId);
    return result.insertedId;
  } catch (err) {
    return manejarError(err, 'crear restaurante');
  }
}

/**
 * crearUsuario(datos) — registra un nuevo usuario (cliente, mesero o admin).
 * @param {Object} datos - { nombre, email, password, rol, preferencias?, restaurante_id? }
 * @returns {ObjectId|null} - El _id del usuario creado
 */
async function crearUsuario(datos) {
  try {
    const db = getDb();
    const usuario = {
      nombre: datos.nombre,
      email: datos.email,
      // bcryptjs hashea la contraseña con 10 rondas de salt
      password_hash: await bcrypt.hash(datos.password || '1234', 10),
      rol: datos.rol,
      activo: true,
      created_at: new Date()
    };

    // Solo los clientes tienen preferencias embebidas
    if (datos.rol === 'cliente') {
      usuario.preferencias = datos.preferencias || { alergias: [], dieta: 'ninguna' };
    }
    // Meseros y admins tienen referencia al restaurante
    if (datos.rol === 'mesero' || datos.rol === 'admin') {
      usuario.restaurante_id = datos.restaurante_id;
    }

    const result = await db.collection('usuarios').insertOne(usuario);
    console.log('Usuario creado con _id:', result.insertedId, '| rol:', datos.rol);
    return result.insertedId;
  } catch (err) {
    return manejarError(err, 'crear usuario');
  }
}

/**
 * crearMenuItem(datos) — agrega un artículo al menú de un restaurante.
 * @param {Object} datos - { restaurante_id, nombre, descripcion, categoria, precio, ingredientes, tiempo }
 * @returns {ObjectId|null}
 */
async function crearMenuItem(datos) {
  try {
    const db = getDb();
    const item = {
      restaurante_id: datos.restaurante_id,
      nombre: datos.nombre,
      descripcion: datos.descripcion || '',
      categoria: datos.categoria,
      precio: datos.precio,
      ingredientes: datos.ingredientes || [],
      disponible: true,
      tiempo_preparacion_min: datos.tiempo || 15,
      created_at: new Date()
    };

    const result = await db.collection('menu_items').insertOne(item);
    console.log('Menu item creado:', datos.nombre, '| precio: Q' + datos.precio);
    return result.insertedId;
  } catch (err) {
    return manejarError(err, 'crear item del menu');
  }
}

/**
 * crearOrden(restauranteId, clienteId, meseroId, numeroMesa, itemsCarrito) — crea una orden.
 * SNAPSHOT: copiamos nombre y precio del producto EN ESE MOMENTO.
 * Si después sube el precio en el menú, la orden NO cambia.
 * @param {ObjectId} restauranteId
 * @param {ObjectId} clienteId
 * @param {ObjectId} meseroId
 * @param {number} numeroMesa
 * @param {Array} itemsCarrito - [{ _id, nombre, precio, cantidad, notas? }]
 * @returns {ObjectId|null}
 */
async function crearOrden(restauranteId, clienteId, meseroId, numeroMesa, itemsCarrito) {
  try {
    const db = getDb();
    // Construir snapshot: copiamos nombre y precio al momento del pedido
    const items = itemsCarrito.map(item => ({
      menu_item_id: item._id,
      nombre: item.nombre,              // copia del nombre actual
      precio_unitario: item.precio,     // copia del precio actual
      cantidad: item.cantidad,
      notas: item.notas || '',
      subtotal: item.precio * item.cantidad  // calculamos el subtotal
    }));

    // Sumamos todos los subtotales para obtener el total de la orden
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
      // historial embebido — trazabilidad completa del ciclo de vida
      historial_estados: [{ estado: 'pendiente', timestamp: new Date() }],
      comprobante_pdf_id: null,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('ordenes').insertOne(orden);
    console.log('Orden creada con _id:', result.insertedId, '| total: Q' + total);
    return result.insertedId;
  } catch (err) {
    return manejarError(err, 'crear orden');
  }
}

/**
 * crearResena(datos) — publica una reseña asociada a restaurante u orden.
 * @param {Object} datos - { restaurante_id, usuario_id, orden_id?, calificacion, titulo, comentario, tags? }
 * @returns {ObjectId|null}
 */
async function crearResena(datos) {
  try {
    const db = getDb();
    const resena = {
      restaurante_id: datos.restaurante_id,
      usuario_id: datos.usuario_id,
      orden_id: datos.orden_id || null,
      // calificacion debe ser Int32 por el validador JSON Schema
      calificacion: datos.calificacion,
      titulo: datos.titulo || '',
      comentario: datos.comentario,
      tags: datos.tags || [],
      created_at: new Date()
    };

    const result = await db.collection('resenas').insertOne(resena);
    console.log('Resena creada con _id:', result.insertedId, '| calificacion:', datos.calificacion);
    return result.insertedId;
  } catch (err) {
    return manejarError(err, 'crear resena');
  }
}

module.exports = { crearRestaurante, crearUsuario, crearMenuItem, crearOrden, crearResena };
