# Queries para Presentacion — Proyecto 1 BD2

Queries ordenados segun la rubrica de calificacion. Cada query indica donde esta implementado en el programa.

---

## 1. DOCUMENTOS EMBEDDED (5pts)

Los documentos embedded son subdocumentos o arrays almacenados DENTRO del documento padre. No requieren JOIN para acceder a ellos.

### 1.1 Ver mesas embebidas dentro del restaurante

```javascript
db.restaurantes.findOne(
  {},
  { nombre: 1, mesas: 1 }
)
```

**Que demuestra:** `mesas` es un array de subdocumentos embebido directamente en el restaurante. Se accede sin JOIN.
**Implementado en:** `src/crud/create.js` → `crearRestaurante()` construye el array `mesas` al crear el restaurante | Menu: Admin > Setup > opcion 12 (seed)

---

### 1.2 Ver items embebidos en una orden

```javascript
db.ordenes.findOne(
  {},
  { numero_mesa: 1, total: 1, items: 1, historial_estados: 1 }
)
```

**Que demuestra:** `items[]` e `historial_estados[]` son arrays embebidos en la orden. Toda la informacion de la orden vive en un solo documento.
**Implementado en:** `src/crud/create.js` → `crearOrden()` / `src/transactions/crearPedido.js` → `crearPedidoAtomico()` | Menu: Mesero > opcion 3

---

### 1.3 Ver respuesta del restaurante embebida en una resena

```javascript
db.resenas.findOne(
  { respuesta_restaurante: { $exists: true } },
  { comentario: 1, calificacion: 1, respuesta_restaurante: 1 }
)
```

**Que demuestra:** `respuesta_restaurante` es un subdocumento embebido `{ texto, fecha }` dentro de la resena.
**Implementado en:** `src/crud/update.js` → `responderResena()` | Menu: Admin > Resenas > opcion 2

---

## 2. DOCUMENTOS REFERENCED (5pts)

Los documentos referenced usan ObjectId para apuntar a documentos en otras colecciones. Se resuelven con `$lookup`.

### 2.1 Ver referencias en una orden

```javascript
db.ordenes.findOne(
  {},
  { restaurante_id: 1, usuario_id: 1, mesero_id: 1, total: 1 }
)
```

**Que demuestra:** Los campos `restaurante_id`, `usuario_id`, `mesero_id` son ObjectId que referencian documentos en otras colecciones.

---

### 2.2 $lookup — Resolver referencias (equivalente a JOIN)

```javascript
db.ordenes.aggregate([
  { $limit: 5 },
  {
    $lookup: {
      from: 'usuarios',
      localField: 'usuario_id',
      foreignField: '_id',
      as: 'cliente'
    }
  },
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
      cliente_nombre: { $arrayElemAt: ['$cliente.nombre', 0] },
      restaurante_nombre: { $arrayElemAt: ['$restaurante.nombre', 0] }
    }
  }
])
```

**Que demuestra:** `$lookup` resuelve las referencias entre colecciones. `$arrayElemAt` extrae el primer resultado del join.
**Implementado en:** `src/crud/read.js` → `lookupOrdenesConDetalle()` | Menu: Admin > Ordenes > opcion 4

---

## 3. CREACION DE DOCUMENTOS (5pts)

### 3.1 insertOne — Crear item del menu

```javascript
db.menu_items.insertOne({
  restaurante_id: db.restaurantes.findOne()._id,
  nombre: 'Platillo de Prueba',
  descripcion: 'Creado en la presentacion',
  categoria: 'entrada',
  precio: 45,
  ingredientes: ['tomate', 'queso'],
  disponible: true,
  tiempo_preparacion_min: 10,
  created_at: new Date()
})
```

**Implementado en:** `src/crud/create.js` → `crearMenuItem()` | Menu: Admin > Gestion del Menu > opcion 2

---

### 3.2 insertOne — Crear resena

```javascript
db.resenas.insertOne({
  restaurante_id: db.restaurantes.findOne()._id,
  usuario_id: db.usuarios.findOne({ rol: 'cliente' })._id,
  calificacion: 5,
  comentario: 'Excelente comida tipica guatemalteca',
  tags: [],
  created_at: new Date()
})
```

**Implementado en:** `src/crud/create.js` → `crearResena()` | Menu: Cliente > opcion 4

---

## 4. CONSULTA DE DOCUMENTOS (5pts)

### 4.1 find — Busqueda full-text con indice de texto

```javascript
db.menu_items.find(
  { $text: { $search: 'pollo' } },
  { nombre: 1, precio: 1, score: { $meta: 'textScore' } }
).sort({ score: { $meta: 'textScore' } })
```

**Que demuestra:** `$text $search` usa el indice de texto sobre `nombre` y `descripcion`. Ordena por relevancia con `textScore`.
**Implementado en:** `src/crud/read.js` → `buscarPlatillos()` | Menu: Cliente > opcion 3

---

### 4.2 find — Busqueda geoespacial con indice 2dsphere

```javascript
db.restaurantes.find({
  activo: true,
  ubicacion: {
    $nearSphere: {
      $geometry: { type: 'Point', coordinates: [-90.5132, 14.5890] },
      $maxDistance: 5000
    }
  }
}, { nombre: 1, direccion: 1, categoria: 1, _id: 0 })
```

**Que demuestra:** `$nearSphere` encuentra restaurantes dentro de 5km de Zona 10, ordenados por distancia. Requiere indice 2dsphere.
**Implementado en:** `src/crud/read.js` → `restaurantesCercanos()` | Menu: Cliente > opcion 1

---

### 4.3 find — Consulta con filtro compuesto

```javascript
db.menu_items.find(
  { restaurante_id: db.restaurantes.findOne()._id, categoria: 'plato_fuerte', disponible: true },
  { nombre: 1, precio: 1, categoria: 1, _id: 0 }
).sort({ precio: 1 })
```

**Implementado en:** `src/crud/read.js` → `menuPorCategoria()` | Menu: Cliente > opcion 2 / Mesero > opcion 5 / Admin > Menu > opcion 1

---

## 5. ACTUALIZACION DE DOCUMENTOS (5pts)

### 5.1 updateOne — Actualizar precio de un platillo

```javascript
db.menu_items.updateOne(
  { nombre: 'Pepian de Res' },
  { $set: { precio: 75 } }
)
```

**Implementado en:** `src/crud/update.js` → `actualizarPrecioMenuItem()` | Menu: Admin > Gestion del Menu > opcion 3

---

### 5.2 updateOne — Cambiar estado de orden + historial embebido

```javascript
db.ordenes.updateOne(
  { _id: db.ordenes.findOne({ estado: 'pendiente' })._id },
  {
    $set: { estado: 'en_preparacion', updated_at: new Date() },
    $push: {
      historial_estados: {
        estado: 'en_preparacion',
        timestamp: new Date(),
        usuario_id: db.usuarios.findOne({ rol: 'mesero' })._id
      }
    }
  }
)
```

**Implementado en:** `src/crud/update.js` → `actualizarEstadoOrden()` | Menu: Mesero > opcion 2 / Admin > Ordenes > opcion 2

---

### 5.3 updateMany — Deshabilitar categoria completa

```javascript
db.menu_items.updateMany(
  { restaurante_id: db.restaurantes.findOne()._id, categoria: 'postre' },
  { $set: { disponible: false } }
)
```

**Que demuestra:** `updateMany` aplica el mismo cambio a TODOS los documentos que coincidan en una sola operacion.
**Implementado en:** `src/crud/update.js` → `deshabilitarCategoriaMenu()` | Menu: Admin > Gestion del Menu > opcion 4

---

## 6. ELIMINACION DE DOCUMENTOS (5pts)

### 6.1 deleteOne — Eliminar item del menu

```javascript
db.menu_items.deleteOne({ nombre: 'Platillo de Prueba' })
```

**Implementado en:** `src/crud/delete.js` → `eliminarMenuItem()` | Menu: Admin > Gestion del Menu > opcion 5

---

### 6.2 deleteMany — Eliminar todas las resenas de un usuario

```javascript
db.resenas.deleteMany({
  usuario_id: db.usuarios.findOne({ rol: 'cliente' })._id
})
```

**Que demuestra:** `deleteMany` elimina multiples documentos en una sola operacion.
**Implementado en:** `src/crud/delete.js` → `eliminarResenasUsuario()` | Menu: Admin > Resenas > opcion 3

---

## 7. ORDENAMIENTO DE CONSULTAS (5pts)

### 7.1 sort ascendente — menu por categoria y precio

```javascript
db.menu_items.find(
  { restaurante_id: db.restaurantes.findOne()._id, disponible: true }
).sort({ categoria: 1, precio: 1 })
```

**Que demuestra:** Sort compuesto. Primero por categoria A-Z, luego por precio menor a mayor dentro de cada categoria.
**Implementado en:** `src/crud/read.js` → `menuPorCategoria()` | Menu: Cliente > opcion 2 / Mesero > opcion 5

---

### 7.2 sort descendente — ordenes mas recientes primero

```javascript
db.ordenes.find(
  { restaurante_id: db.restaurantes.findOne()._id }
).sort({ created_at: -1 }).limit(10)
```

**Que demuestra:** `-1` ordena de mas reciente a mas antiguo.
**Implementado en:** `src/crud/read.js` → `ordenesPorRestaurante()` | Menu: Mesero > opcion 1 / Admin > Ordenes > opcion 1

---

### 7.3 sort por relevancia — busqueda full-text

```javascript
db.menu_items.find(
  { $text: { $search: 'pollo crema' } },
  { nombre: 1, precio: 1, score: { $meta: 'textScore' } }
).sort({ score: { $meta: 'textScore' } })
```

**Que demuestra:** `$meta: 'textScore'` ordena los resultados por relevancia. Los mas relevantes primero.
**Implementado en:** `src/crud/read.js` → `buscarPlatillos()` | Menu: Cliente > opcion 3

---

### 7.4 sort en pipeline de agregacion

```javascript
db.ordenes.aggregate([
  { $match: { estado: 'pagado' } },
  { $unwind: '$items' },
  { $group: { _id: '$items.nombre', total: { $sum: '$items.cantidad' } } },
  { $sort: { total: -1 } },
  { $limit: 5 }
])
```

**Que demuestra:** `$sort` dentro de un pipeline de agregacion.
**Implementado en:** `src/aggregations/pipelines.js` → `top5Platillos()` | Menu: Admin > Pipelines > opcion 3

---

## 8. PROYECCIONES (5pts)

### 8.1 Projection de INCLUSION simple — solo nombre, precio y categoria

```javascript
db.menu_items.find(
  { disponible: true },
  { nombre: 1, precio: 1, categoria: 1, _id: 0 }
).sort({ precio: 1 })
```

**Que demuestra:** `{ campo: 1 }` incluye solo esos campos. `_id: 0` excluye el _id. Ningun otro campo aparece.
**Implementado en:** `src/crud/projections.js` → `projectionMenuSimple()` | Menu: Admin > Projections > opcion 1

---

### 8.2 Projection de INCLUSION + paginacion — ordenes sin el array items

```javascript
db.ordenes.find(
  {},
  { numero_mesa: 1, estado: 1, total: 1, created_at: 1 }
).sort({ created_at: -1 }).skip(0).limit(5)
```

**Que demuestra:** Trae ordenes ligeras sin el array `items`. El array items puede ser pesado — la projection evita traerlo innecesariamente.
**Implementado en:** `src/crud/projections.js` → `projectionOrdenesSinItems()` | Menu: Admin > Projections > opcion 2

---

### 8.3 Projection de EXCLUSION — usuarios sin password_hash

```javascript
db.usuarios.find(
  { rol: 'cliente' },
  { password_hash: 0 }
).limit(5)
```

**Que demuestra:** `{ campo: 0 }` trae TODOS los campos MENOS ese. El frontend nunca debe recibir el hash de la contrasena.
**Implementado en:** `src/crud/projections.js` → `projectionUsuarioSinPassword()` | Menu: Admin > Projections > opcion 3

---

## 9. MANEJO DE ARCHIVOS — GridFS (10pts)

```javascript
// Listar archivos subidos
db.getCollection('comprobantes.files').find()

// Ver chunks de un archivo (sin mostrar el binario)
db.getCollection('comprobantes.chunks').find(
  { files_id: db.getCollection('comprobantes.files').findOne()._id },
  { data: 0 }
)
```

**Que demuestra:** GridFS divide archivos en chunks de 255KB almacenados en `comprobantes.chunks`. Los metadatos (nombre, tamano, fecha) van en `comprobantes.files`. Permite almacenar archivos mayores a 16MB.
**Implementado en:** `src/gridfs/comprobantes.js` → `subirComprobante`, `descargarComprobante`, `eliminarComprobante`, `listarComprobantes` | Menu: Admin > GridFS > opciones 1-4 / Mesero > opcion 4 (cerrar pedido genera PDF automaticamente)

---

## 10. AGREGACIONES SIMPLES (10pts)

### 10.1 Pipeline de 1 etapa — Total de ordenes por restaurante

```javascript
db.ordenes.aggregate([
  { $group: { _id: '$restaurante_id', total: { $sum: 1 } } }
])
```

**Que demuestra:** El pipeline mas simple posible. Una sola etapa `$group`. Equivale a `SELECT restaurante_id, COUNT(*) FROM ordenes GROUP BY restaurante_id`.
**Implementado en:** `src/aggregations/pipelines.js` → `totalOrdenesPorRestaurante()` | Menu: Admin > Pipelines > opcion 1

---

### 10.2 Pipeline simple — Conteo de ordenes por estado

```javascript
db.ordenes.aggregate([
  { $match: { restaurante_id: db.restaurantes.findOne()._id } },
  { $group: { _id: '$estado', total: { $sum: 1 } } },
  { $sort: { total: -1 } }
])
```

**Que demuestra:** `$match` filtra, `$group` agrupa y cuenta, `$sort` ordena. 3 etapas secuenciales.
**Implementado en:** `src/aggregations/pipelines.js` → `conteoOrdenesPorEstado()` | Menu: Admin > Pipelines > opcion 2

---

## 11. AGREGACIONES COMPLEJAS (15pts)

### 11.1 Top 5 platillos mas vendidos

```javascript
db.ordenes.aggregate([
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
  { $lookup: {
      from: 'menu_items',
      localField: '_id',
      foreignField: '_id',
      as: 'info'
  }},
  { $project: {
      nombre: 1,
      total_vendido: 1,
      ingresos: 1,
      categoria: { $arrayElemAt: ['$info.categoria', 0] }
  }}
])
```

**Que demuestra:** `$unwind` explota el array `items` (1 orden con 3 items → 3 documentos). `$group` agrupa por platillo. `$lookup` une con `menu_items` para traer la categoria.
**Implementado en:** `src/aggregations/pipelines.js` → `top5Platillos()` | Menu: Admin > Pipelines > opcion 3

---

### 11.2 Restaurantes mejor calificados

```javascript
db.resenas.aggregate([
  { $group: {
      _id: '$restaurante_id',
      promedio: { $avg: '$calificacion' },
      total: { $sum: 1 }
  }},
  { $match: { total: { $gte: 5 } } },
  { $lookup: {
      from: 'restaurantes',
      localField: '_id',
      foreignField: '_id',
      as: 'rest'
  }},
  { $unwind: '$rest' },
  { $project: {
      nombre: '$rest.nombre',
      promedio: { $round: ['$promedio', 1] },
      total_resenas: '$total'
  }},
  { $sort: { promedio: -1 } },
  { $limit: 10 }
])
```

**Que demuestra:** `$avg` calcula promedio de calificaciones. `$match` post-group filtra los que tienen 5+ resenas. `$round` redondea a 1 decimal.
**Implementado en:** `src/aggregations/pipelines.js` → `restaurantesMejorCalificados()` | Menu: Admin > Pipelines > opcion 4

---

### 11.3 Ingresos por restaurante en un periodo

```javascript
db.ordenes.aggregate([
  { $match: {
      estado: 'pagado',
      created_at: {
        $gte: new Date('2025-01-01'),
        $lt: new Date('2027-01-01')
      }
  }},
  { $group: {
      _id: '$restaurante_id',
      ingresos: { $sum: '$total' },
      ordenes: { $sum: 1 },
      ticket_promedio: { $avg: '$total' }
  }},
  { $lookup: {
      from: 'restaurantes',
      localField: '_id',
      foreignField: '_id',
      as: 'rest'
  }},
  { $project: {
      nombre: { $arrayElemAt: ['$rest.nombre', 0] },
      ingresos: 1,
      ordenes: 1,
      ticket_promedio: { $round: ['$ticket_promedio', 2] }
  }},
  { $sort: { ingresos: -1 } }
])
```

**Que demuestra:** Filtra por rango de fechas con `$gte/$lt`. `$sum` para ingresos totales. `$avg` para ticket promedio. `$round` redondea a 2 decimales.
**Implementado en:** `src/aggregations/pipelines.js` → `ingresosPorPeriodo()` | Menu: Admin > Pipelines > opcion 5

---

## 12. MANEJO DE ARRAYS (10pts)

### 12.1 $addToSet — Agregar tag sin duplicar

```javascript
db.restaurantes.updateOne(
  { nombre: 'El Rincon Guatemalteco' },
  { $addToSet: { tags: 'pet_friendly' } }
)
```

**Implementado en:** `src/crud/arrays.js` → `agregarTagRestaurante()` | Menu: Admin > Arrays > opcion 5

---

### 12.2 $addToSet — Intentar agregar duplicado (no modifica)

```javascript
// Correr el mismo query otra vez — modifiedCount sera 0
db.restaurantes.updateOne(
  { nombre: 'El Rincon Guatemalteco' },
  { $addToSet: { tags: 'pet_friendly' } }
)
```

**Que demuestra:** Si el valor ya existe en el array, `$addToSet` no hace nada. `modifiedCount: 0`.
**Implementado en:** `src/crud/arrays.js` → `agregarTagRestaurante()` | Menu: Admin > Arrays > opcion 5

---

### 12.3 $pull — Eliminar tag del array

```javascript
db.restaurantes.updateOne(
  { nombre: 'El Rincon Guatemalteco' },
  { $pull: { tags: 'pet_friendly' } }
)
```

**Implementado en:** `src/crud/arrays.js` → `quitarTagRestaurante()` | Menu: Admin > Arrays > opcion 3

---

### 12.4 $push + $inc — Agregar item a orden y actualizar total

```javascript
db.ordenes.updateOne(
  {
    _id: db.ordenes.findOne({ estado: 'pendiente' })._id,
    estado: { $nin: ['pagado', 'cancelado'] }
  },
  {
    $push: {
      items: {
        menu_item_id: db.menu_items.findOne()._id,
        nombre: 'Item Extra',
        precio_unitario: 25,
        cantidad: 1,
        notas: 'agregado en presentacion',
        subtotal: 25
      }
    },
    $inc: { total: 25 }
  }
)
```

**Que demuestra:** `$push` agrega al array embebido `items`. `$inc` incrementa el total en la misma operacion atomica.
**Implementado en:** `src/crud/arrays.js` → `agregarItemAOrden()` | Menu: Mesero > opcion 6 / Admin > Arrays > opcion 1

---

## 13. LIMITE DE REGISTROS (5pts)

### 13.1 Paginacion con skip + limit

```javascript
// Pagina 1 — primeros 5 resultados
db.ordenes.find(
  { restaurante_id: db.restaurantes.findOne()._id },
  { numero_mesa: 1, estado: 1, total: 1 }
).sort({ created_at: -1 }).skip(0).limit(5)

// Pagina 2 — siguientes 5
db.ordenes.find(
  { restaurante_id: db.restaurantes.findOne()._id },
  { numero_mesa: 1, estado: 1, total: 1 }
).sort({ created_at: -1 }).skip(5).limit(5)

// Pagina 3
db.ordenes.find(
  { restaurante_id: db.restaurantes.findOne()._id },
  { numero_mesa: 1, estado: 1, total: 1 }
).sort({ created_at: -1 }).skip(10).limit(5)
```

**Que demuestra:** Formula: `skip = (pagina - 1) * limite`. Cada pagina salta los documentos anteriores.
**Implementado en:** `src/crud/read.js` → `ordenesPorRestaurante()` / `src/crud/projections.js` → `projectionOrdenesSinItems()` | Menu: Mesero > opcion 1 / Admin > Ordenes > opcion 1 / Admin > Projections > opcion 2

---

### 13.2 limit en pipeline — Top N resultados

```javascript
db.ordenes.aggregate([
  { $match: { estado: 'pagado' } },
  { $unwind: '$items' },
  { $group: { _id: '$items.nombre', total: { $sum: '$items.cantidad' } } },
  { $sort: { total: -1 } },
  { $limit: 5 }
])
```

**Implementado en:** `src/aggregations/pipelines.js` → `top5Platillos()` | Menu: Admin > Pipelines > opcion 3

---

## 14. MANEJO DE DOCUMENTOS EMBEDDED — Operaciones avanzadas (10pts)

### 14.1 Actualizar campo dentro de array embebido — operador posicional $

```javascript
// Ocupar mesa 2 (poner disponible: false)
db.restaurantes.updateOne(
  { _id: db.restaurantes.findOne()._id, 'mesas.numero': 2 },
  { $set: { 'mesas.$.disponible': false } }
)

// Liberar mesa 2 (poner disponible: true)
db.restaurantes.updateOne(
  { _id: db.restaurantes.findOne()._id, 'mesas.numero': 2 },
  { $set: { 'mesas.$.disponible': true } }
)
```

**Que demuestra:** El operador posicional `$` apunta al elemento del array que coincidio con el filtro (`'mesas.numero': 2`). Actualiza solo ese elemento sin reescribir todo el array.
**Implementado en:** `src/transactions/crearPedido.js` y `src/transactions/cerrarPedido.js` | Menu: Mesero > opcion 3 (crear pedido) y opcion 4 (cerrar pedido)

---

### 14.2 Filtrar y proyectar sobre campo de array embebido — dot notation

```javascript
// Buscar ordenes que contengan 'Pepian de Res' y retornar solo ese item
db.ordenes.find(
  { 'items.nombre': 'Pepian de Res' },
  { numero_mesa: 1, total: 1, 'items.$': 1 }
).limit(3)
```

**Que demuestra:** Dot notation (`items.nombre`) filtra dentro del array embebido. `items.$` retorna solo el elemento que coincidio.
**Implementado en:** `QUERIES_PRESENTACION.md §15` (Snapshot Pattern)

---

### 14.3 $unwind — Explotar array embebido para procesarlo

```javascript
// Convertir cada item de cada orden en un documento separado
db.ordenes.aggregate([
  { $match: { estado: 'pagado' } },
  { $unwind: '$items' },
  { $project: {
      numero_mesa: 1,
      'items.nombre': 1,
      'items.cantidad': 1,
      'items.subtotal': 1
  }},
  { $limit: 10 }
])
```

**Que demuestra:** `$unwind` "explota" el array `items[]`. Una orden con 3 items se convierte en 3 documentos separados. Necesario para agrupar y analizar items individualmente.
**Implementado en:** `src/aggregations/pipelines.js` → `top5Platillos()` | Menu: Admin > Pipelines > opcion 3

---

### 14.4 Actualizar subdocumento embebido — respuesta del restaurante

```javascript
db.resenas.updateOne(
  { _id: db.resenas.findOne({ restaurante_id: db.restaurantes.findOne()._id })._id },
  {
    $set: {
      respuesta_restaurante: {
        texto: 'Gracias por su visita, lo esperamos pronto',
        fecha: new Date()
      }
    }
  }
)
```

**Que demuestra:** Actualiza un subdocumento embebido completo con `$set`. El campo `respuesta_restaurante` es un objeto `{ texto, fecha }` dentro de la resena.
**Implementado en:** `src/crud/update.js` → `responderResena()` | Menu: Admin > Resenas > opcion 2

---

## 15. OPERACIONES BULK (10pts)

### 15.1 bulkWrite — Habilitar y deshabilitar items en una sola operacion

```javascript
var items = db.menu_items.find(
  { restaurante_id: db.restaurantes.findOne()._id }
).limit(4).toArray()

db.menu_items.bulkWrite([
  { updateOne: { filter: { _id: items[0]._id }, update: { $set: { disponible: false } } } },
  { updateOne: { filter: { _id: items[1]._id }, update: { $set: { disponible: false } } } },
  { updateOne: { filter: { _id: items[2]._id }, update: { $set: { disponible: true  } } } },
  { updateOne: { filter: { _id: items[3]._id }, update: { $set: { disponible: true  } } } }
])
```

**Que demuestra:** `bulkWrite` envia N operaciones distintas en un solo roundtrip al servidor. Diferencia clave vs `updateMany`: `updateMany` aplica el MISMO cambio a todos los documentos que coincidan, `bulkWrite` permite valores distintos por documento. Util para cambiar la disponibilidad del menu del dia.
**Implementado en:** `src/crud/update.js` → `bulkActualizarDisponibilidadMenu()` | Menu: Admin > Gestion del Menu > opcion 6

---

### 15.2 Verificar resultado del bulkWrite

```javascript
// El resultado muestra:
// matchedCount: 4   → encontro los 4 documentos
// modifiedCount: 4  → modifico los 4
// insertedCount: 0, deletedCount: 0, upsertedCount: 0
```

---

## 16. BI CONNECTORS (10pts)

El archivo `src/etl/etl.js` extrae todos los datos de MongoDB, los aplana y los carga en PostgreSQL (Aiven) para conectar con Power BI.

### 16.1 Correr el ETL

```bash
node src/etl/etl.js
```

**Que hace:**
1. Lee las 6 colecciones de MongoDB Atlas
2. Aplana arrays embebidos (`ordenes.items[]` → tabla `orden_items` con una fila por item)
3. Crea tablas en PostgreSQL: `restaurantes`, `usuarios`, `menu_items`, `ordenes`, `orden_items`, `resenas`, `event_logs`
4. Inserta en lotes de 500/1000 filas para no saturar la memoria
5. Crea 6 views listas para Power BI

---

### 16.2 Verificar datos cargados en PostgreSQL

```sql
SELECT 'restaurantes' AS tabla, COUNT(*) FROM restaurantes
UNION ALL SELECT 'usuarios',    COUNT(*) FROM usuarios
UNION ALL SELECT 'menu_items',  COUNT(*) FROM menu_items
UNION ALL SELECT 'ordenes',     COUNT(*) FROM ordenes
UNION ALL SELECT 'orden_items', COUNT(*) FROM orden_items
UNION ALL SELECT 'resenas',     COUNT(*) FROM resenas
UNION ALL SELECT 'event_logs',  COUNT(*) FROM event_logs;
```

---

### 16.3 Views disponibles para Power BI

```sql
SELECT * FROM v_ventas_por_restaurante;   -- ingresos y ticket promedio por restaurante
SELECT * FROM v_top_platillos;            -- platillos mas vendidos con ingresos
SELECT * FROM v_ordenes_por_estado;       -- conteo de ordenes por estado y restaurante
SELECT * FROM v_calificaciones;           -- promedio de resenas por restaurante
SELECT * FROM v_actividad_diaria;         -- logs de actividad por dia y tipo
SELECT * FROM v_ingresos_mensuales;       -- ingresos por mes y restaurante
```

**Implementado en:** `src/etl/etl.js`

---

## REFERENCIA — Queries de apoyo para la presentacion

### Indices — Ver todos los creados

```javascript
db.usuarios.getIndexes()
db.ordenes.getIndexes()
db.menu_items.getIndexes()
db.restaurantes.getIndexes()
db.resenas.getIndexes()
```

**Los 9 indices:** unique email / simple estado / compuesto {restaurante_id, created_at} / compuesto {restaurante_id, categoria} / multikey tags x2 / 2dsphere ubicacion / text nombre+descripcion / text comentario
**Implementado en:** `src/collections/createIndexes.js` | Menu: Admin > Indices > opcion 1 / Admin > Setup > opcion 12

---

### Explain — Verificar uso de indices

```javascript
// IXSCAN en ordenes
db.ordenes.find({ restaurante_id: db.restaurantes.findOne()._id, estado: 'pendiente' }).explain('executionStats')

// GEO_NEAR_2DSPHERE
db.restaurantes.find({ ubicacion: { $nearSphere: { $geometry: { type: 'Point', coordinates: [-90.5132, 14.5890] }, $maxDistance: 5000 } } }).explain('executionStats')

// TEXT_MATCH
db.menu_items.find({ $text: { $search: 'pollo' } }).explain('executionStats')
```

**Implementado en:** `src/menu/menu.js` → `adminIndices()` | Menu: Admin > Indices > opciones 2, 3, 4

---

### JSON Schema Validation — Probar que rechaza datos invalidos

```javascript
// Rol invalido — debe fallar
db.usuarios.insertOne({ nombre: 'Test', email: 'x@x.com', password_hash: 'h', rol: 'superadmin', activo: true, created_at: new Date() })

// items vacio — debe fallar
db.ordenes.insertOne({ restaurante_id: db.restaurantes.findOne()._id, usuario_id: db.usuarios.findOne()._id, mesero_id: db.usuarios.findOne({ rol: 'mesero' })._id, numero_mesa: 1, estado: 'pendiente', items: [], total: 0, created_at: new Date() })

// calificacion fuera de rango — debe fallar
db.resenas.insertOne({ restaurante_id: db.restaurantes.findOne()._id, usuario_id: db.usuarios.findOne()._id, calificacion: 10, comentario: 'invalida', created_at: new Date() })
```

**Implementado en:** `src/collections/createCollections.js` | Menu: Admin > Setup > opcion 12

---

### Snapshot Pattern — Demostrar que ordenes no cambian al actualizar precios

```javascript
// 1. Precio actual en el menu
db.menu_items.findOne({ nombre: 'Pepian de Res' }, { nombre: 1, precio: 1 })

// 2. Precio guardado en la orden (snapshot al momento del pedido)
db.ordenes.findOne({ 'items.nombre': 'Pepian de Res' }, { 'items.$': 1, total: 1 })

// 3. Cambiar precio en el menu
db.menu_items.updateOne({ nombre: 'Pepian de Res' }, { $set: { precio: 999 } })

// 4. La orden NO cambio — precio historico intacto
db.ordenes.findOne({ 'items.nombre': 'Pepian de Res' }, { 'items.$': 1, total: 1 })

// 5. Revertir
db.menu_items.updateOne({ nombre: 'Pepian de Res' }, { $set: { precio: 65 } })
```

**Implementado en:** `src/transactions/crearPedido.js` → items se mapean copiando `precio_unitario: item.precio` al momento del pedido

---

### Transacciones — Flujo completo (demostrar en menu interactivo)

```bash
node src/menu/menu.js
```

1. Login como admin o mesero
2. **Crear pedido atomico** → Mesero opcion 3 / Admin > Transacciones > opcion 1
   - Inserta orden + ocupa mesa atomicamente. Si falla uno, rollback total.
   - Verificar en Compass: `mesas.$.disponible: false`
3. **Cerrar pedido atomico** → Mesero opcion 4 / Admin > Transacciones > opcion 2
   - Actualiza orden a pagado + genera PDF en GridFS + libera mesa + registra event_log
   - Verificar en Compass: orden pagada, mesa libre, PDF en `comprobantes.files`, evento en `event_logs`

**Implementado en:** `src/transactions/crearPedido.js` → `crearPedidoAtomico()` / `src/transactions/cerrarPedido.js` → `cerrarPedidoAtomico()`
