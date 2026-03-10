/**
 * ETL — MongoDB → PostgreSQL
 *
 * Lee todas las colecciones de MongoDB Atlas y las carga en PostgreSQL
 * con tablas planas listas para conectar en Power BI.
 *
 * Variables requeridas en .env:
 *   MONGO_URI, DB_NAME          (ya existentes)
 *   PG_HOST, PG_PORT            (ej: pg-xxx.aivencloud.com  /  28060)
 *   PG_DATABASE                 (ej: defaultdb)
 *   PG_USER, PG_PASSWORD        (ya existentes)
 *
 * Uso: node src/etl/etl.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { Pool } = require('pg');

// ─── Conexiones ──────────────────────────────────────────────────────────────

const mongoClient = new MongoClient(process.env.MONGO_URI);

const pg = new Pool({
  host:     process.env.PG_HOST,
  port:     parseInt(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl:      { rejectUnauthorized: false }   // requerido en Aiven / Atlas PostgreSQL
});

// ─── Schema ───────────────────────────────────────────────────────────────────

async function crearTablas(c) {
  await c.query(`

    CREATE TABLE IF NOT EXISTS restaurantes (
      id                    TEXT PRIMARY KEY,
      nombre                TEXT,
      categoria             TEXT,
      direccion             TEXT,
      lat                   FLOAT,
      lng                   FLOAT,
      calificacion_promedio FLOAT,
      activo                BOOLEAN,
      created_at            TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id         TEXT PRIMARY KEY,
      nombre     TEXT,
      email      TEXT,
      rol        TEXT,
      activo     BOOLEAN,
      created_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id                    TEXT PRIMARY KEY,
      restaurante_id        TEXT,
      nombre                TEXT,
      categoria             TEXT,
      precio                FLOAT,
      disponible            BOOLEAN,
      tiempo_preparacion_min INTEGER,
      created_at            TIMESTAMP
    );

    -- Cabecera de la orden (sin el array items)
    CREATE TABLE IF NOT EXISTS ordenes (
      id             TEXT PRIMARY KEY,
      restaurante_id TEXT,
      usuario_id     TEXT,
      mesero_id      TEXT,
      numero_mesa    INTEGER,
      estado         TEXT,
      total          FLOAT,
      metodo_pago    TEXT,
      created_at     TIMESTAMP,
      updated_at     TIMESTAMP
    );

    -- Items de cada orden aplanados (1 fila por item)
    -- JOIN con ordenes por orden_id para analisis de ventas
    CREATE TABLE IF NOT EXISTS orden_items (
      orden_id         TEXT,
      restaurante_id   TEXT,
      menu_item_id     TEXT,
      nombre_item      TEXT,
      precio_unitario  FLOAT,
      cantidad         INTEGER,
      subtotal         FLOAT
    );

    CREATE TABLE IF NOT EXISTS resenas (
      id             TEXT PRIMARY KEY,
      restaurante_id TEXT,
      usuario_id     TEXT,
      calificacion   INTEGER,
      comentario     TEXT,
      created_at     TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id             TEXT PRIMARY KEY,
      tipo           TEXT,
      usuario_id     TEXT,
      restaurante_id TEXT,
      detalle        TEXT,
      timestamp      TIMESTAMP
    );

  `);
  console.log('  Tablas listas');
}

async function truncarTablas(c) {
  // Orden inverso a dependencias para evitar FK issues si se agregan luego
  await c.query(`
    TRUNCATE TABLE orden_items;
    TRUNCATE TABLE event_logs;
    TRUNCATE TABLE resenas;
    TRUNCATE TABLE ordenes;
    TRUNCATE TABLE menu_items;
    TRUNCATE TABLE usuarios;
    TRUNCATE TABLE restaurantes;
  `);
  console.log('  Tablas truncadas');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Inserta filas en lotes para no saturar la memoria ni hacer un query enorme
async function insertarEnLotes(c, tabla, columnas, filas, tamLote = 500) {
  if (filas.length === 0) return;
  const cols = columnas.join(', ');

  for (let i = 0; i < filas.length; i += tamLote) {
    const lote = filas.slice(i, i + tamLote);
    const placeholders = lote.map((_, fi) =>
      '(' + columnas.map((__, ci) => `$${fi * columnas.length + ci + 1}`).join(', ') + ')'
    ).join(', ');

    const valores = lote.flat();
    await c.query(`INSERT INTO ${tabla} (${cols}) VALUES ${placeholders} ON CONFLICT DO NOTHING`, valores);
  }
}

const str = (v) => (v != null ? String(v) : null);
const num = (v) => (v != null && !isNaN(v) ? Number(v) : null);
const ts  = (v) => (v instanceof Date ? v : v ? new Date(v) : null);

// ─── ETL por colección ────────────────────────────────────────────────────────

async function etlRestaurantes(db, c) {
  const docs = await db.collection('restaurantes').find({}).toArray();
  const filas = docs.map(d => [
    str(d._id),
    d.nombre,
    d.categoria,
    d.direccion || '',
    num(d.ubicacion?.coordinates?.[1]),   // lat
    num(d.ubicacion?.coordinates?.[0]),   // lng
    num(d.calificacion_promedio),
    d.activo ?? true,
    ts(d.created_at)
  ]);
  await insertarEnLotes(c, 'restaurantes',
    ['id','nombre','categoria','direccion','lat','lng','calificacion_promedio','activo','created_at'],
    filas);
  console.log(`  restaurantes: ${docs.length} filas`);
}

async function etlUsuarios(db, c) {
  const docs = await db.collection('usuarios').find({}).toArray();
  const filas = docs.map(d => [
    str(d._id), d.nombre, d.email, d.rol, d.activo ?? true, ts(d.created_at)
  ]);
  await insertarEnLotes(c, 'usuarios',
    ['id','nombre','email','rol','activo','created_at'],
    filas);
  console.log(`  usuarios: ${docs.length} filas`);
}

async function etlMenuItems(db, c) {
  const docs = await db.collection('menu_items').find({}).toArray();
  const filas = docs.map(d => [
    str(d._id), str(d.restaurante_id), d.nombre, d.categoria,
    num(d.precio), d.disponible ?? true, d.tiempo_preparacion_min || null, ts(d.created_at)
  ]);
  await insertarEnLotes(c, 'menu_items',
    ['id','restaurante_id','nombre','categoria','precio','disponible','tiempo_preparacion_min','created_at'],
    filas);
  console.log(`  menu_items: ${docs.length} filas`);
}

async function etlOrdenes(db, c) {
  const docs = await db.collection('ordenes').find({}).toArray();

  // Tabla ordenes — cabecera
  const filasOrdenes = docs.map(d => [
    str(d._id), str(d.restaurante_id), str(d.usuario_id), str(d.mesero_id),
    d.numero_mesa, d.estado, num(d.total), d.metodo_pago || null,
    ts(d.created_at), ts(d.updated_at)
  ]);
  await insertarEnLotes(c, 'ordenes',
    ['id','restaurante_id','usuario_id','mesero_id','numero_mesa','estado','total','metodo_pago','created_at','updated_at'],
    filasOrdenes);

  // Tabla orden_items — aplanar el array embebido items
  // Una fila por item dentro de cada orden (útil para análisis de ventas)
  const filasItems = [];
  for (const d of docs) {
    if (!Array.isArray(d.items)) continue;
    for (const it of d.items) {
      filasItems.push([
        str(d._id),
        str(d.restaurante_id),
        str(it.menu_item_id),
        it.nombre,
        num(it.precio_unitario),
        it.cantidad,
        num(it.subtotal)
      ]);
    }
  }
  await insertarEnLotes(c, 'orden_items',
    ['orden_id','restaurante_id','menu_item_id','nombre_item','precio_unitario','cantidad','subtotal'],
    filasItems);

  console.log(`  ordenes: ${docs.length} filas | orden_items: ${filasItems.length} filas`);
}

async function etlResenas(db, c) {
  const docs = await db.collection('resenas').find({}).toArray();
  const filas = docs.map(d => [
    str(d._id), str(d.restaurante_id), str(d.usuario_id),
    d.calificacion, d.comentario, ts(d.created_at)
  ]);
  await insertarEnLotes(c, 'resenas',
    ['id','restaurante_id','usuario_id','calificacion','comentario','created_at'],
    filas);
  console.log(`  resenas: ${docs.length} filas`);
}

async function etlEventLogs(db, c) {
  const docs = await db.collection('event_logs').find({}).toArray();
  const filas = docs.map(d => [
    str(d._id), d.tipo, str(d.usuario_id), str(d.restaurante_id),
    d.detalle || '', ts(d.timestamp)
  ]);
  // Lotes más pequeños para 50k docs
  await insertarEnLotes(c, 'event_logs',
    ['id','tipo','usuario_id','restaurante_id','detalle','timestamp'],
    filas, 1000);
  console.log(`  event_logs: ${docs.length} filas`);
}

// ─── Views sugeridas para Power BI ───────────────────────────────────────────

async function crearViews(c) {
  await c.query(`

    -- Ventas por restaurante
    CREATE OR REPLACE VIEW v_ventas_por_restaurante AS
    SELECT
      r.nombre                          AS restaurante,
      COUNT(o.id)                       AS total_ordenes,
      SUM(o.total)                      AS ingresos_total,
      ROUND(AVG(o.total)::NUMERIC, 2)   AS ticket_promedio
    FROM ordenes o
    JOIN restaurantes r ON r.id = o.restaurante_id
    WHERE o.estado = 'pagado'
    GROUP BY r.nombre;

    -- Platillos mas vendidos
    CREATE OR REPLACE VIEW v_top_platillos AS
    SELECT
      oi.nombre_item                    AS platillo,
      r.nombre                          AS restaurante,
      SUM(oi.cantidad)                  AS unidades_vendidas,
      SUM(oi.subtotal)                  AS ingresos
    FROM orden_items oi
    JOIN ordenes o    ON o.id  = oi.orden_id
    JOIN restaurantes r ON r.id = oi.restaurante_id
    WHERE o.estado = 'pagado'
    GROUP BY oi.nombre_item, r.nombre
    ORDER BY unidades_vendidas DESC;

    -- Ordenes por estado
    CREATE OR REPLACE VIEW v_ordenes_por_estado AS
    SELECT
      r.nombre   AS restaurante,
      o.estado,
      COUNT(*)   AS cantidad
    FROM ordenes o
    JOIN restaurantes r ON r.id = o.restaurante_id
    GROUP BY r.nombre, o.estado;

    -- Calificacion promedio por restaurante
    CREATE OR REPLACE VIEW v_calificaciones AS
    SELECT
      r.nombre                          AS restaurante,
      COUNT(re.id)                      AS total_resenas,
      ROUND(AVG(re.calificacion)::NUMERIC, 2) AS promedio
    FROM resenas re
    JOIN restaurantes r ON r.id = re.restaurante_id
    GROUP BY r.nombre;

    -- Actividad de logs por tipo y dia
    CREATE OR REPLACE VIEW v_actividad_diaria AS
    SELECT
      DATE(timestamp)  AS fecha,
      tipo,
      COUNT(*)         AS cantidad
    FROM event_logs
    GROUP BY DATE(timestamp), tipo
    ORDER BY fecha DESC;

    -- Ingresos por mes
    CREATE OR REPLACE VIEW v_ingresos_mensuales AS
    SELECT
      r.nombre                              AS restaurante,
      TO_CHAR(o.created_at, 'YYYY-MM')      AS mes,
      COUNT(o.id)                           AS ordenes,
      SUM(o.total)                          AS ingresos
    FROM ordenes o
    JOIN restaurantes r ON r.id = o.restaurante_id
    WHERE o.estado = 'pagado'
    GROUP BY r.nombre, TO_CHAR(o.created_at, 'YYYY-MM')
    ORDER BY mes DESC;

  `);
  console.log('  Views creadas: v_ventas_por_restaurante, v_top_platillos, v_ordenes_por_estado,');
  console.log('                 v_calificaciones, v_actividad_diaria, v_ingresos_mensuales');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== ETL: MongoDB → PostgreSQL ===\n');

  // Validar variables de entorno
  const faltantes = ['MONGO_URI','DB_NAME','PG_HOST','PG_DATABASE','PG_USER','PG_PASSWORD']
    .filter(v => !process.env[v]);
  if (faltantes.length > 0) {
    console.error('Faltan variables de entorno:', faltantes.join(', '));
    process.exit(1);
  }

  // Conectar a MongoDB
  await mongoClient.connect();
  const db = mongoClient.db(process.env.DB_NAME);
  console.log('MongoDB: conectado a', process.env.DB_NAME);

  // Conectar a PostgreSQL
  const pgClient = await pg.connect();
  console.log('PostgreSQL: conectado a', process.env.PG_DATABASE, '\n');

  try {
    console.log('[ 1/3 ] Preparando schema...');
    await crearTablas(pgClient);
    await truncarTablas(pgClient);

    console.log('\n[ 2/3 ] Cargando datos...');
    await etlRestaurantes(db, pgClient);
    await etlUsuarios(db, pgClient);
    await etlMenuItems(db, pgClient);
    await etlOrdenes(db, pgClient);
    await etlResenas(db, pgClient);
    await etlEventLogs(db, pgClient);

    console.log('\n[ 3/3 ] Creando views para Power BI...');
    await crearViews(pgClient);

    console.log('\n=== ETL completado ===\n');

  } finally {
    pgClient.release();
    await pg.end();
    await mongoClient.close();
  }
}

main().catch(err => {
  console.error('Error en ETL:', err.message);
  process.exit(1);
});
