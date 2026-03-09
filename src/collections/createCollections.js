const { conectar, getDb } = require('../db/connection');

/**
 * crearColecciones() — crea las 6 colecciones del sistema con JSON Schema Validation.
 * Cada colección tiene un validador que define campos obligatorios y tipos de dato.
 * validationAction: 'error' hace que MongoDB RECHACE documentos que no cumplan el esquema.
 */
async function crearColecciones() {
  const db = getDb();

  // Obtenemos las colecciones existentes para no intentar crear una que ya existe
  const coleccionesExistentes = (await db.listCollections().toArray()).map(c => c.name);

  // =====================================================
  // 1. RESTAURANTES
  // Campos obligatorios: nombre, categoria, ubicacion (GeoJSON), mesas (array), activo, created_at
  // La ubicacion debe ser un GeoJSON Point para que funcione el índice 2dsphere
  // Las mesas van embebidas porque siempre se consultan junto con el restaurante
  // =====================================================
  if (!coleccionesExistentes.includes('restaurantes')) {
    await db.createCollection('restaurantes', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['nombre', 'categoria', 'ubicacion', 'mesas', 'activo', 'created_at'],
          properties: {
            nombre: { bsonType: 'string' },
            categoria: { bsonType: 'string' },
            // ubicacion debe ser GeoJSON Point para el índice 2dsphere
            ubicacion: {
              bsonType: 'object',
              required: ['type', 'coordinates'],
              properties: {
                type: { bsonType: 'string', enum: ['Point'] },
                // coordinates: [longitud, latitud] — exactamente 2 elementos
                coordinates: { bsonType: 'array', minItems: 2, maxItems: 2 }
              }
            },
            // mesas embebidas — al menos 1 mesa por restaurante
            mesas: { bsonType: 'array', minItems: 1 },
            activo: { bsonType: 'bool' }
          }
        }
      },
      validationAction: 'error'
    });
    console.log('Coleccion "restaurantes" creada con validacion');
  } else {
    console.log('Coleccion "restaurantes" ya existe — se omite');
  }

  // =====================================================
  // 2. USUARIOS
  // Campos obligatorios: nombre, email, password_hash, rol, activo, created_at
  // rol solo puede ser 'cliente', 'mesero' o 'admin'
  // El email se validará como único mediante un índice (Etapa 3)
  // =====================================================
  if (!coleccionesExistentes.includes('usuarios')) {
    await db.createCollection('usuarios', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['nombre', 'email', 'password_hash', 'rol', 'activo', 'created_at'],
          properties: {
            nombre: { bsonType: 'string' },
            email: { bsonType: 'string' },
            password_hash: { bsonType: 'string' },
            // rol solo puede ser uno de estos tres valores
            rol: { bsonType: 'string', enum: ['cliente', 'mesero', 'admin'] },
            activo: { bsonType: 'bool' }
          }
        }
      },
      validationAction: 'error'
    });
    console.log('Coleccion "usuarios" creada con validacion');
  } else {
    console.log('Coleccion "usuarios" ya existe — se omite');
  }

  // =====================================================
  // 3. MENU_ITEMS
  // Campos obligatorios: restaurante_id, nombre, categoria, precio, disponible, created_at
  // precio debe ser un número >= 0 (no puede haber precios negativos)
  // Se referencia al restaurante con restaurante_id
  // =====================================================
  if (!coleccionesExistentes.includes('menu_items')) {
    await db.createCollection('menu_items', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['restaurante_id', 'nombre', 'categoria', 'precio', 'disponible', 'created_at'],
          properties: {
            nombre: { bsonType: 'string' },
            categoria: { bsonType: 'string' },
            // precio mínimo 0 — no puede ser negativo
            precio: { bsonType: 'number', minimum: 0 },
            disponible: { bsonType: 'bool' }
          }
        }
      },
      validationAction: 'error'
    });
    console.log('Coleccion "menu_items" creada con validacion');
  } else {
    console.log('Coleccion "menu_items" ya existe — se omite');
  }

  // =====================================================
  // 4. ORDENES — la más compleja
  // Campos obligatorios: restaurante_id, usuario_id, mesero_id, numero_mesa, estado, items, total, created_at
  // estado solo puede tener 5 valores posibles (enum)
  // items es un array embebido con snapshot del pedido — mínimo 1 ítem
  // total debe ser >= 0
  // =====================================================
  if (!coleccionesExistentes.includes('ordenes')) {
    await db.createCollection('ordenes', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['restaurante_id', 'usuario_id', 'mesero_id',
            'numero_mesa', 'estado', 'items', 'total', 'created_at'],
          properties: {
            // estado solo puede tener estos 5 valores
            estado: {
              bsonType: 'string',
              enum: ['pendiente', 'en_preparacion', 'servido', 'pagado', 'cancelado']
            },
            // total mínimo 0
            total: { bsonType: 'number', minimum: 0 },
            // items embebidos como snapshot: al menos 1 ítem por orden
            items: { bsonType: 'array', minItems: 1 }
          }
        }
      },
      validationAction: 'error'
    });
    console.log('Coleccion "ordenes" creada con validacion');
  } else {
    console.log('Coleccion "ordenes" ya existe — se omite');
  }

  // =====================================================
  // 5. RESENAS
  // Campos obligatorios: restaurante_id, usuario_id, calificacion, comentario, created_at
  // calificacion debe ser un entero entre 1 y 5
  // =====================================================
  if (!coleccionesExistentes.includes('resenas')) {
    await db.createCollection('resenas', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['restaurante_id', 'usuario_id', 'calificacion', 'comentario', 'created_at'],
          properties: {
            // calificacion: entero entre 1 y 5
            calificacion: { bsonType: 'int', minimum: 1, maximum: 5 }
          }
        }
      },
      validationAction: 'error'
    });
    console.log('Coleccion "resenas" creada con validacion');
  } else {
    console.log('Coleccion "resenas" ya existe — se omite');
  }

  // =====================================================
  // 6. EVENT_LOGS (50,000+ documentos)
  // Campos obligatorios: tipo, usuario_id, restaurante_id, timestamp
  // tipo solo puede ser: login, orden_creada, pago, error
  // Se mantiene como colección separada por su alto volumen
  // =====================================================
  if (!coleccionesExistentes.includes('event_logs')) {
    await db.createCollection('event_logs', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['tipo', 'usuario_id', 'restaurante_id', 'timestamp'],
          properties: {
            tipo: {
              bsonType: 'string',
              enum: ['login', 'orden_creada', 'pago', 'error']
            }
          }
        }
      },
      validationAction: 'error'
    });
    console.log('Coleccion "event_logs" creada con validacion');
  } else {
    console.log('Coleccion "event_logs" ya existe — se omite');
  }

  // =====================================================
  // ACTIVAR NOTABLESCAN
  // Rechaza queries que hagan full collection scan (sin índice)
  // Esto nos fuerza a tener índices para todas nuestras consultas
  // NOTA: En Atlas Free/Shared no se puede activar (requiere M10+)
  // =====================================================
  try {
    await db.admin().command({ setParameter: 1, notablescan: 1 });
    console.log('notablescan activado — todos los queries deben usar indice');
  } catch (err) {
    console.log('AVISO: notablescan no se pudo activar (normal en Atlas Free Tier)');
    console.log('  Motivo:', err.message);
  }

  console.log('\n=== 6 colecciones creadas con JSON Schema Validation ===');
}

module.exports = { crearColecciones };

// Ejecutar directamente si se llama con: node src/collections/createCollections.js
if (require.main === module) {
  (async () => {
    const { client } = await conectar();
    await crearColecciones();
    await client.close();
  })().catch(console.error);
}
