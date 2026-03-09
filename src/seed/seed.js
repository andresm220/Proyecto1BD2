const { conectar, getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { faker } = require('@faker-js/faker');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

// Configuramos faker en español para nombres y textos mas realistas
faker.locale = 'es';

// =====================================================
// DATOS BASE PARA GENERAR DOCUMENTOS REALISTAS
// Usamos datos de Guatemala para que el contexto sea coherente
// =====================================================

// Coordenadas reales de zonas en Ciudad de Guatemala
const UBICACIONES_GT = [
  { nombre: 'El Rincon Guatemalteco', lng: -90.5069, lat: 14.6407, dir: 'Zona 1, Ciudad de Guatemala' },
  { nombre: 'La Terraza Chapina', lng: -90.5132, lat: 14.5890, dir: 'Zona 10, Ciudad de Guatemala' },
  { nombre: 'Antojitos Don Pedro', lng: -90.5225, lat: 14.6052, dir: 'Zona 4, Ciudad de Guatemala' },
  { nombre: 'Casa del Cafe', lng: -90.4950, lat: 14.5735, dir: 'Zona 14, Ciudad de Guatemala' },
  { nombre: 'Parrilla del Centro', lng: -90.5180, lat: 14.6340, dir: 'Zona 1, Centro Historico' }
];

const CATEGORIAS_RESTAURANTE = ['guatemalteca', 'mexicana', 'italiana', 'cafeteria', 'parrilla'];
const TAGS_RESTAURANTE = ['familiar', 'terraza', 'wifi', 'parqueo', 'musica_en_vivo', 'pet_friendly', 'aire_acondicionado'];

// Platillos organizados por categoría
const PLATILLOS = {
  entrada: [
    { nombre: 'Guacamol con Totopos', precio: 35, desc: 'Guacamole fresco con totopos de maiz', tiempo: 10 },
    { nombre: 'Ceviche de Camarones', precio: 55, desc: 'Camarones frescos marinados en limon', tiempo: 15 },
    { nombre: 'Tamalitos de Chipilin', precio: 25, desc: 'Tamalitos tradicionales de chipilin', tiempo: 12 },
    { nombre: 'Chiles Rellenos', precio: 40, desc: 'Chiles poblanos rellenos de queso', tiempo: 15 },
    { nombre: 'Elotes Locos', precio: 20, desc: 'Elotes asados con mayonesa y queso', tiempo: 8 },
    { nombre: 'Sopa de Frijol', precio: 30, desc: 'Sopa cremosa de frijol negro', tiempo: 10 },
    { nombre: 'Empanadas de Loroco', precio: 28, desc: 'Empanadas rellenas de loroco y queso', tiempo: 12 },
    { nombre: 'Dobladas de Pollo', precio: 22, desc: 'Tortillas dobladas con pollo y guacamol', tiempo: 10 },
  ],
  plato_fuerte: [
    { nombre: 'Pepian de Res', precio: 65, desc: 'Platillo tradicional guatemalteco con recado de pepian', tiempo: 25 },
    { nombre: 'Kaq Ik', precio: 70, desc: 'Caldo de chunto (pavo) tipico de Alta Verapaz', tiempo: 30 },
    { nombre: 'Pollo en Crema', precio: 55, desc: 'Pollo en salsa cremosa con loroco', tiempo: 20 },
    { nombre: 'Hilachas', precio: 50, desc: 'Carne deshilachada en salsa de tomate', tiempo: 25 },
    { nombre: 'Carne Asada', precio: 85, desc: 'Corte de res a la parrilla con chimichurri', tiempo: 20 },
    { nombre: 'Jocón de Pollo', precio: 55, desc: 'Pollo en salsa verde de miltomate', tiempo: 25 },
    { nombre: 'Revolcado', precio: 60, desc: 'Cabeza de cerdo en recado rojo picante', tiempo: 30 },
    { nombre: 'Subanik', precio: 65, desc: 'Guiso de tres carnes envuelto en hoja de maxan', tiempo: 35 },
  ],
  postre: [
    { nombre: 'Rellenitos de Platano', precio: 25, desc: 'Platano maduro relleno de frijol dulce', tiempo: 10 },
    { nombre: 'Tres Leches', precio: 35, desc: 'Pastel bañado en tres tipos de leche', tiempo: 5 },
    { nombre: 'Buñuelos con Miel', precio: 20, desc: 'Buñuelos de viento con miel de abeja', tiempo: 12 },
    { nombre: 'Platanos en Mole', precio: 30, desc: 'Platanos maduros fritos en salsa de mole', tiempo: 10 },
    { nombre: 'Champurradas', precio: 15, desc: 'Galletas tradicionales guatemaltecas', tiempo: 5 },
    { nombre: 'Molletes', precio: 18, desc: 'Pan dulce tradicional con azucar', tiempo: 5 },
  ],
  bebida: [
    { nombre: 'Horchata', precio: 15, desc: 'Bebida tradicional de morro y cacao', tiempo: 5 },
    { nombre: 'Fresco de Rosa de Jamaica', precio: 12, desc: 'Agua fresca de flor de jamaica', tiempo: 5 },
    { nombre: 'Cafe Antigueño', precio: 20, desc: 'Cafe de Antigua Guatemala recien preparado', tiempo: 5 },
    { nombre: 'Limonada con Hierba Buena', precio: 15, desc: 'Limonada natural con hierba buena', tiempo: 5 },
    { nombre: 'Chocolate Caliente', precio: 18, desc: 'Chocolate artesanal guatemalteco', tiempo: 8 },
    { nombre: 'Atol de Elote', precio: 15, desc: 'Bebida caliente de maiz dulce', tiempo: 8 },
  ]
};

const ALERGIAS = ['mani', 'gluten', 'lactosa', 'mariscos', 'huevo', 'ninguna'];
const DIETAS = ['ninguna', 'vegetariana', 'vegana', 'sin_gluten', 'keto'];
const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia'];
const TAGS_RESENA = ['rapido', 'sabroso', 'buen_servicio', 'buena_presentacion', 'abundante', 'fresco', 'economico', 'lento', 'frio'];

// =====================================================
// FUNCIONES PARA GENERAR CADA TIPO DE DOCUMENTO
// =====================================================

/**
 * generarRestaurantes() — crea 5 restaurantes con coordenadas reales de Guatemala.
 * Cada uno tiene entre 3 y 8 mesas embebidas.
 */
function generarRestaurantes() {
  return UBICACIONES_GT.map((ub, i) => {
    // Generamos entre 3 y 8 mesas por restaurante
    const numMesas = faker.number.int({ min: 3, max: 8 });
    const mesas = Array.from({ length: numMesas }, (_, j) => ({
      numero: j + 1,
      capacidad: faker.helpers.arrayElement([2, 4, 6, 8]),
      disponible: true  // todas inician disponibles
    }));

    return {
      nombre: ub.nombre,
      descripcion: faker.lorem.sentence(),
      categoria: CATEGORIAS_RESTAURANTE[i],
      telefono: faker.phone.number('+502 ####-####'),
      email: faker.internet.email({ firstName: ub.nombre.split(' ')[0].toLowerCase() }),
      // ubicacion en formato GeoJSON Point — requerido para el indice 2dsphere
      ubicacion: {
        type: 'Point',
        coordinates: [ub.lng, ub.lat]  // [longitud, latitud]
      },
      direccion: ub.dir,
      // horario embebido como objeto
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
      // cada restaurante tiene entre 2 y 4 tags aleatorios
      tags: faker.helpers.arrayElements(TAGS_RESTAURANTE, { min: 2, max: 4 }),
      calificacion_promedio: 0,  // se actualizará con las reseñas
      activo: true,
      created_at: new Date()
    };
  });
}

/**
 * generarUsuarios(restauranteIds) — crea 20 usuarios: 13 clientes, 5 meseros, 2 admins.
 * Los meseros y admins se asignan a un restaurante mediante restaurante_id.
 * Los clientes tienen preferencias embebidas (alergias y dieta).
 */
async function generarUsuarios(restauranteIds) {
  const usuarios = [];
  // Hasheamos '1234' una sola vez y reutilizamos (misma contraseña demo para todos)
  const hashedPassword = await bcrypt.hash('1234', 10);

  // 13 clientes — con preferencias embebidas
  for (let i = 0; i < 13; i++) {
    const nombre = faker.person.fullName();
    usuarios.push({
      nombre,
      email: faker.internet.email({ firstName: nombre.split(' ')[0].toLowerCase() }) + i,
      password_hash: hashedPassword,
      rol: 'cliente',
      preferencias: {
        alergias: faker.helpers.arrayElements(ALERGIAS, { min: 0, max: 2 }),
        dieta: faker.helpers.arrayElement(DIETAS)
      },
      activo: true,
      created_at: new Date()
    });
  }

  // 5 meseros — uno por restaurante
  for (let i = 0; i < 5; i++) {
    const nombre = faker.person.fullName();
    usuarios.push({
      nombre,
      email: faker.internet.email({ firstName: 'mesero' + i }),
      password_hash: hashedPassword,
      rol: 'mesero',
      restaurante_id: restauranteIds[i],  // asignado a su restaurante
      activo: true,
      created_at: new Date()
    });
  }

  // 2 admins — asignados a los primeros 2 restaurantes
  for (let i = 0; i < 2; i++) {
    const nombre = faker.person.fullName();
    usuarios.push({
      nombre,
      email: faker.internet.email({ firstName: 'admin' + i }),
      password_hash: hashedPassword,
      rol: 'admin',
      restaurante_id: restauranteIds[i],
      activo: true,
      created_at: new Date()
    });
  }

  return usuarios;
}

/**
 * generarMenuItems(restauranteIds) — crea 40 platillos distribuidos entre restaurantes.
 * Cada restaurante recibe 8 platillos: 2 de cada categoría.
 */
function generarMenuItems(restauranteIds) {
  const items = [];
  const categorias = Object.keys(PLATILLOS);

  restauranteIds.forEach(restId => {
    // 2 platillos por categoría = 8 por restaurante = 40 total
    categorias.forEach(cat => {
      const platillosCategoria = faker.helpers.arrayElements(PLATILLOS[cat], 2);
      platillosCategoria.forEach(p => {
        items.push({
          restaurante_id: restId,
          nombre: p.nombre,
          descripcion: p.desc,
          categoria: cat,
          precio: p.precio,
          ingredientes: faker.helpers.arrayElements(
            ['res', 'pollo', 'tomate', 'cebolla', 'chile', 'maiz', 'frijol', 'queso', 'crema', 'aguacate'],
            { min: 2, max: 5 }
          ),
          disponible: true,
          tiempo_preparacion_min: p.tiempo,
          created_at: new Date()
        });
      });
    });
  });

  return items;
}

/**
 * generarOrdenes(restauranteIds, clienteIds, meseroIds, menuItems) — crea 100 órdenes.
 * Los items se guardan como SNAPSHOT: copiamos nombre y precio al momento del pedido.
 * Cada orden tiene historial_estados embebido para trazabilidad.
 */
function generarOrdenes(restauranteIds, clienteIds, meseroIds, menuItems) {
  const ordenes = [];
  const estados = ['pendiente', 'en_preparacion', 'servido', 'pagado', 'cancelado'];

  for (let i = 0; i < 100; i++) {
    // Elegimos un restaurante aleatorio
    const restId = faker.helpers.arrayElement(restauranteIds);
    // Filtramos los platillos de ESE restaurante
    const menuRest = menuItems.filter(m => m.restaurante_id.equals(restId));
    if (menuRest.length === 0) continue;

    // Elegimos entre 1 y 4 platillos para esta orden
    const itemsElegidos = faker.helpers.arrayElements(menuRest, { min: 1, max: 4 });

    // SNAPSHOT: copiamos nombre y precio al momento del pedido
    // Si despues cambia el precio en el menú, la orden NO se afecta
    const items = itemsElegidos.map(item => {
      const cantidad = faker.number.int({ min: 1, max: 3 });
      return {
        menu_item_id: item._id,
        nombre: item.nombre,              // copia del nombre actual
        precio_unitario: item.precio,     // copia del precio actual
        cantidad,
        notas: faker.helpers.maybe(() => faker.helpers.arrayElement(['sin picante', 'extra queso', 'bien cocido', 'sin cebolla']), { probability: 0.3 }) || '',
        subtotal: item.precio * cantidad  // precio * cantidad
      };
    });

    const total = items.reduce((sum, it) => sum + it.subtotal, 0);
    const estado = faker.helpers.arrayElement(estados);

    // Generamos historial de estados embebido
    // Simula el ciclo de vida: pendiente -> en_preparacion -> servido -> pagado
    const meseroOrden = faker.helpers.arrayElement(meseroIds);
    const historial = [{ estado: 'pendiente', timestamp: faker.date.recent({ days: 90 }), usuario_id: meseroOrden }];
    const flujo = ['en_preparacion', 'servido', 'pagado'];
    const idxEstado = estados.indexOf(estado);
    for (let j = 0; j < Math.min(idxEstado, 3); j++) {
      historial.push({
        estado: flujo[j],
        timestamp: new Date(historial[historial.length - 1].timestamp.getTime() + (j + 1) * 600000),
        usuario_id: meseroOrden  // trazabilidad: quien hizo el cambio
      });
    }

    ordenes.push({
      restaurante_id: restId,
      usuario_id: faker.helpers.arrayElement(clienteIds),
      mesero_id: meseroOrden,
      numero_mesa: faker.number.int({ min: 1, max: 6 }),
      estado,
      items,
      total,
      metodo_pago: estado === 'pagado' ? faker.helpers.arrayElement(METODOS_PAGO) : null,
      historial_estados: historial,
      comprobante_pdf_id: null,
      created_at: faker.date.recent({ days: 90 }),
      updated_at: new Date()
    });
  }

  return ordenes;
}

/**
 * generarResenas(restauranteIds, clienteIds, ordenIds) — crea 80 reseñas.
 * calificacion es un entero (Int32) entre 1 y 5.
 * Algunas incluyen respuesta_restaurante embebida.
 */
function generarResenas(restauranteIds, clienteIds, ordenIds) {
  const resenas = [];

  for (let i = 0; i < 80; i++) {
    const resena = {
      restaurante_id: faker.helpers.arrayElement(restauranteIds),
      usuario_id: faker.helpers.arrayElement(clienteIds),
      orden_id: faker.helpers.maybe(() => faker.helpers.arrayElement(ordenIds), { probability: 0.6 }) || null,
      // IMPORTANTE: calificacion debe ser Int32 (no float) por el validador
      calificacion: faker.number.int({ min: 1, max: 5 }),
      titulo: faker.helpers.arrayElement([
        'Excelente experiencia', 'Muy bueno', 'Regular', 'Podria mejorar',
        'Increible comida', 'Buen servicio', 'Delicioso', 'No volveria',
        'Lo mejor de la zona', 'Comida tipica autentica'
      ]),
      comentario: faker.lorem.paragraph(),
      tags: faker.helpers.arrayElements(TAGS_RESENA, { min: 1, max: 3 }),
      created_at: faker.date.recent({ days: 60 })
    };

    // 30% de las reseñas tienen respuesta del restaurante embebida
    if (Math.random() < 0.3) {
      resena.respuesta_restaurante = {
        texto: faker.helpers.arrayElement([
          'Gracias por su visita, esperamos verle pronto!',
          'Lamentamos su experiencia, trabajaremos para mejorar.',
          'Nos alegra que haya disfrutado su comida!',
          'Gracias por sus comentarios, los tomaremos en cuenta.'
        ]),
        fecha: new Date()
      };
    }

    resenas.push(resena);
  }

  return resenas;
}

// =====================================================
// FUNCION PRINCIPAL — EJECUTAR SEED
// =====================================================

/**
 * ejecutarSeed() — llena la base de datos en el orden correcto.
 * Orden: restaurantes -> usuarios -> menu_items -> ordenes -> resenas -> event_logs
 * Este orden es necesario porque cada colección referencia IDs de las anteriores.
 */
async function ejecutarSeed() {
  const db = getDb();

  try {
    // Limpiamos las colecciones antes de insertar (para poder re-ejecutar)
    console.log('\nLimpiando colecciones existentes...');
    const colecciones = ['event_logs', 'resenas', 'ordenes', 'menu_items', 'usuarios', 'restaurantes'];
    for (const col of colecciones) {
      await db.collection(col).deleteMany({});
    }
    console.log('Colecciones limpiadas\n');

    // --- 1. RESTAURANTES (5) ---
    console.log('Insertando 5 restaurantes...');
    const restaurantes = generarRestaurantes();
    const resRest = await db.collection('restaurantes').insertMany(restaurantes);
    const restauranteIds = Object.values(resRest.insertedIds);
    console.log(`  -> ${resRest.insertedCount} restaurantes insertados`);

    // --- 2. USUARIOS (20) ---
    console.log('Insertando 20 usuarios (13 clientes, 5 meseros, 2 admins)...');
    const usuarios = await generarUsuarios(restauranteIds);
    const resUsers = await db.collection('usuarios').insertMany(usuarios);
    const todosUserIds = Object.values(resUsers.insertedIds);
    // Separamos IDs por rol para usarlos en las ordenes
    const clienteIds = todosUserIds.slice(0, 13);
    const meseroIds = todosUserIds.slice(13, 18);
    console.log(`  -> ${resUsers.insertedCount} usuarios insertados`);

    // --- 3. MENU_ITEMS (40) ---
    console.log('Insertando 40 platillos del menu...');
    const menuItems = generarMenuItems(restauranteIds);
    const resMenu = await db.collection('menu_items').insertMany(menuItems);
    // Añadimos los _id generados a los objetos para usarlos en ordenes
    menuItems.forEach((item, idx) => {
      item._id = resMenu.insertedIds[idx];
    });
    console.log(`  -> ${resMenu.insertedCount} platillos insertados`);

    // --- 4. ORDENES (100) ---
    console.log('Insertando 100 ordenes con snapshot de items...');
    const ordenes = generarOrdenes(restauranteIds, clienteIds, meseroIds, menuItems);
    const resOrdenes = await db.collection('ordenes').insertMany(ordenes);
    const ordenIds = Object.values(resOrdenes.insertedIds);
    console.log(`  -> ${resOrdenes.insertedCount} ordenes insertadas`);

    // --- 5. RESENAS (80) ---
    console.log('Insertando 80 resenas...');
    const resenas = generarResenas(restauranteIds, clienteIds, ordenIds);
    const resResenas = await db.collection('resenas').insertMany(resenas);
    console.log(`  -> ${resResenas.insertedCount} resenas insertadas`);

    // --- 6. EVENT_LOGS (50,000+) ---
    // Insertamos en lotes de 1,000 para no saturar la memoria
    console.log('Insertando 50,000 event_logs en lotes de 1,000...');
    const TOTAL_LOGS = 50000;
    const LOTE = 1000;

    for (let i = 0; i < TOTAL_LOGS; i += LOTE) {
      const lote = Array.from({ length: LOTE }, () => ({
        tipo: faker.helpers.arrayElement(['login', 'orden_creada', 'pago', 'error']),
        usuario_id: faker.helpers.arrayElement(todosUserIds),
        restaurante_id: faker.helpers.arrayElement(restauranteIds),
        detalle: faker.lorem.sentence(),
        timestamp: faker.date.recent({ days: 90 })
      }));
      // insertMany es mucho mas eficiente que 1,000 llamadas a insertOne
      await db.collection('event_logs').insertMany(lote);
      // Mostramos progreso cada 10,000 registros
      const progreso = Math.min(i + LOTE, TOTAL_LOGS);
      if (progreso % 10000 === 0 || progreso === TOTAL_LOGS) {
        console.log(`  -> Progreso: ${progreso.toLocaleString()} / ${TOTAL_LOGS.toLocaleString()}`);
      }
    }

    // --- RESUMEN FINAL ---
    console.log('\n=== SEED COMPLETADO ===');
    console.log('  Restaurantes:', await db.collection('restaurantes').countDocuments());
    console.log('  Usuarios:', await db.collection('usuarios').countDocuments());
    console.log('  Menu Items:', await db.collection('menu_items').countDocuments());
    console.log('  Ordenes:', await db.collection('ordenes').countDocuments());
    console.log('  Resenas:', await db.collection('resenas').countDocuments());
    console.log('  Event Logs:', (await db.collection('event_logs').countDocuments()).toLocaleString());

  } catch (err) {
    manejarError(err, 'ejecutar seed de datos');
  }
}

module.exports = { ejecutarSeed };

// Ejecutar directamente: node src/seed/seed.js
if (require.main === module) {
  (async () => {
    const { client } = await conectar();
    await ejecutarSeed();
    await client.close();
  })().catch(console.error);
}
