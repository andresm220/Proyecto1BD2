# Queries para Presentacion — Proyecto 1 BD2

Estos queries se pueden ejecutar directamente en **NoSQLBooster**, **MongoDB Compass** (Shell) o **mongosh**. Estan organizados por tema.


## 1. PROJECTIONS

### 1.1 Projection de INCLUSION simple — solo nombre, precio y categoria (sin _id)

```javascript
db.menu_items.find(
  { disponible: true },
  { nombre: 1, precio: 1, categoria: 1, _id: 0 }
).sort({ precio: 1 })
```

**Que demuestra:** Solo retorna los 3 campos pedidos. El `_id: 0` excluye el _id. Ningun otro campo aparece.

### 1.2 Projection de INCLUSION + paginacion — ordenes sin el array items

```javascript
db.ordenes.find(
  {},
  { numero_mesa: 1, estado: 1, total: 1, created_at: 1 }
).sort({ created_at: -1 }).skip(0).limit(5)
```

**Que demuestra:** Trae ordenes ligeras sin el array `items` (que puede ser pesado). Combina projection con skip/limit para paginar. Cambiar `skip(0)` a `skip(5)` muestra la pagina 2.

### 1.3 Projection de EXCLUSION — usuarios sin password_hash

```javascript
db.usuarios.find(
  { rol: 'cliente' },
  { password_hash: 0 }
).limit(5)
```

**Que demuestra:** Trae TODOS los campos MENOS `password_hash`. El frontend nunca debe recibir el hash de la contraseña.

---

## 2. CRUD

### 2.1 CREATE — Insertar un item al menu

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

### 2.2 READ — Busqueda full-text

```javascript
db.menu_items.find(
  { $text: { $search: 'pollo' } },
  { nombre: 1, precio: 1, score: { $meta: 'textScore' } }
).sort({ score: { $meta: 'textScore' } })
```

**Que demuestra:** Busca "pollo" en nombre y descripcion usando el indice de texto. Ordena por relevancia.

### 2.3 READ — Busqueda geoespacial (restaurantes cercanos)

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

**Que demuestra:** Encuentra restaurantes a menos de 5km de Zona 10, ordenados por distancia. Usa el indice 2dsphere.

### 2.4 UPDATE — Actualizar precio (no afecta ordenes existentes por snapshot)

```javascript
db.menu_items.updateOne(
  { nombre: 'Pepian de Res' },
  { $set: { precio: 75 } }
)
```

### 2.5 UPDATE — Cambiar estado de orden + agregar al historial

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

### 2.6 DELETE — Eliminar un item del menu

```javascript
db.menu_items.deleteOne({ nombre: 'Platillo de Prueba' })
```

---

## 3. OPERADORES DE ARRAYS

### 3.1 $addToSet — Agregar tag sin duplicar

```javascript
// Agrega 'pet_friendly' solo si no existe ya
db.restaurantes.updateOne(
  { nombre: 'El Rincon Guatemalteco' },
  { $addToSet: { tags: 'pet_friendly' } }
)
```

### 3.2 $addToSet — Intentar agregar duplicado (no modifica)

```javascript
// Ejecutar el mismo query otra vez — modifiedCount sera 0
db.restaurantes.updateOne(
  { nombre: 'El Rincon Guatemalteco' },
  { $addToSet: { tags: 'pet_friendly' } }
)
```

### 3.3 $pull — Eliminar tag

```javascript
db.restaurantes.updateOne(
  { nombre: 'El Rincon Guatemalteco' },
  { $pull: { tags: 'pet_friendly' } }
)
```

### 3.4 $push — Agregar item a una orden

```javascript
db.ordenes.updateOne(
  { _id: db.ordenes.findOne({ estado: 'pendiente' })._id },
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
    }
  }
)
```

---

## 4. AGGREGATION PIPELINES

### 4.1 Pipeline SIMPLE — Conteo de ordenes por estado

```javascript
db.ordenes.aggregate([
  { $match: { restaurante_id: db.restaurantes.findOne()._id } },
  { $group: { _id: '$estado', total: { $sum: 1 } } },
  { $sort: { total: -1 } }
])
```

**Que demuestra:** $match filtra, $group agrupa por estado y cuenta, $sort ordena.

### 4.2 Pipeline COMPLEJA 1 — Top 5 platillos mas vendidos

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

**Que demuestra:** $unwind explota el array items, $group agrupa por platillo, $lookup une con menu_items (como JOIN), $project selecciona campos finales.

### 4.3 Pipeline COMPLEJA 2 — Restaurantes mejor calificados

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

**Que demuestra:** $avg calcula promedio, $match filtra los que tienen 5+ resenas, $lookup trae nombre del restaurante, $round redondea.

### 4.4 Pipeline COMPLEJA 3 — Ingresos por restaurante en un periodo

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

**Que demuestra:** Filtra por rango de fechas, $sum para ingresos, $avg para ticket promedio, $round redondea.

---

## 5. EXPLAIN — Verificar uso de indices

### 5.1 Verificar IXSCAN en ordenes

```javascript
db.ordenes.find({
  restaurante_id: db.restaurantes.findOne()._id,
  estado: 'pendiente'
}).explain('executionStats')
```

**Buscar en el resultado:** `winningPlan.inputStage.stage` debe ser `IXSCAN` (no `COLLSCAN`).

### 5.2 Verificar GEO_NEAR_2DSPHERE

```javascript
db.restaurantes.find({
  ubicacion: {
    $nearSphere: {
      $geometry: { type: 'Point', coordinates: [-90.5132, 14.5890] },
      $maxDistance: 5000
    }
  }
}).explain('executionStats')
```

**Buscar:** `winningPlan.stage` debe ser `GEO_NEAR_2DSPHERE`.

### 5.3 Verificar TEXT_MATCH

```javascript
db.menu_items.find(
  { $text: { $search: 'pollo' } }
).explain('executionStats')
```

**Buscar:** `winningPlan.stage` debe ser `TEXT_MATCH` o `TEXT_OR`.

---

## 6. INDICES — Ver todos los creados

```javascript
// Ver indices de cada coleccion
db.usuarios.getIndexes()
db.ordenes.getIndexes()
db.menu_items.getIndexes()
db.restaurantes.getIndexes()
db.resenas.getIndexes()
```

**Los 9 indices que deben aparecer:**
1. `usuarios.email` (unique)
2. `ordenes.estado`
3. `ordenes.{restaurante_id, created_at}`
4. `menu_items.{restaurante_id, categoria}`
5. `restaurantes.tags`
6. `resenas.tags`
7. `restaurantes.ubicacion` (2dsphere)
8. `menu_items.{nombre, descripcion}` (text)
9. `resenas.comentario` (text)

---

## 7. JSON SCHEMA VALIDATION — Probar que rechaza datos invalidos

### 7.1 Intentar insertar usuario con rol invalido

```javascript
db.usuarios.insertOne({
  nombre: 'Test',
  email: 'test@test.com',
  password_hash: 'hash',
  rol: 'superadmin',
  activo: true,
  created_at: new Date()
})
// DEBE FALLAR — 'superadmin' no esta en el enum del validador
```

### 7.2 Intentar insertar orden sin items

```javascript
db.ordenes.insertOne({
  restaurante_id: db.restaurantes.findOne()._id,
  usuario_id: db.usuarios.findOne()._id,
  mesero_id: db.usuarios.findOne({ rol: 'mesero' })._id,
  numero_mesa: 1,
  estado: 'pendiente',
  items: [],
  total: 0,
  created_at: new Date()
})
// DEBE FALLAR — items requiere minItems: 1
```

### 7.3 Intentar insertar resena con calificacion fuera de rango

```javascript
db.resenas.insertOne({
  restaurante_id: db.restaurantes.findOne()._id,
  usuario_id: db.usuarios.findOne()._id,
  calificacion: 10,
  comentario: 'Calificacion invalida',
  created_at: new Date()
})
// DEBE FALLAR — calificacion debe ser int entre 1 y 5
```

---

## 8. GRIDFS — Verificar comprobantes PDF

```javascript
// Listar archivos en GridFS
db.getCollection('comprobantes.files').find()

// Ver chunks asociados
db.getCollection('comprobantes.chunks').find(
  { files_id: db.getCollection('comprobantes.files').findOne()._id },
  { data: 0 }
)
```

---

## 9. SNAPSHOT PATTERN — Demostrar que ordenes no cambian

```javascript
// 1. Ver precio actual de un platillo
db.menu_items.findOne({ nombre: 'Pepian de Res' }, { nombre: 1, precio: 1 })

// 2. Ver que la orden tiene el precio AL MOMENTO DEL PEDIDO
db.ordenes.findOne(
  { 'items.nombre': 'Pepian de Res' },
  { 'items.$': 1, total: 1 }
)

// 3. Cambiar el precio en el menu
db.menu_items.updateOne({ nombre: 'Pepian de Res' }, { $set: { precio: 999 } })

// 4. Verificar que la orden NO cambio (sigue con el precio original)
db.ordenes.findOne(
  { 'items.nombre': 'Pepian de Res' },
  { 'items.$': 1, total: 1 }
)
```

**Que demuestra:** El snapshot copia nombre y precio al momento del pedido. Cambiar el menu no afecta ordenes existentes.

---

## 10. TRANSACCIONES — Flujo completo

Las transacciones se demuestran mejor desde el menu interactivo (`node src/menu/menu.js`):

1. **Login** como admin o mesero
2. **Opcion 3 (Transacciones)** → Crear pedido atomico
   - Inserta orden + ocupa mesa (atomico)
   - Verificar en Compass que la mesa quedo `disponible: false`
3. **Opcion 3 (Transacciones)** → Cerrar pedido atomico
   - Actualiza orden a 'pagado' + genera PDF en GridFS + libera mesa + registra log (atomico)
   - Verificar en Compass: orden pagada, mesa `disponible: true`, PDF en `comprobantes.files`, evento en `event_logs`
