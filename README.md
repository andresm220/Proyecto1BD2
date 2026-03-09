# Documentacion del Proyecto 1 — Base de Datos 2 (CC3089)

## Sistema de Gestion de Reservas y Pedidos para Restaurante Fisico

**Universidad del Valle de Guatemala — 2026**
**Tecnologias:** Node.js + MongoDB Atlas (driver nativo) + pdf-lib + faker.js

---

## Estructura del Proyecto

```
Proyecto1BD2/
├── .env                          # Variables de entorno (URI de Atlas, nombre de BD)
├── .gitignore                    # Ignora node_modules/ y .env
├── package.json                  # Dependencias: mongodb, dotenv, pdf-lib, @faker-js/faker
├── test_validacion_final.js      # Script de validacion final (Etapa 12)
└── src/
    ├── db/
    │   ├── connection.js         # Conexion singleton a MongoDB Atlas
    │   └── errors.js             # Manejo centralizado de errores en espanol
    ├── collections/
    │   ├── createCollections.js  # Crea 6 colecciones con JSON Schema Validation
    │   └── createIndexes.js      # Crea 9 indices (unico, compuesto, multikey, geo, texto)
    ├── seed/
    │   └── seed.js               # Genera datos realistas con faker.js
    ├── crud/
    │   ├── create.js             # insertOne para cada coleccion
    │   ├── read.js               # Queries con $nearSphere, $text, $lookup, paginacion
    │   ├── update.js             # updateOne, updateMany, $set, $push
    │   ├── delete.js             # deleteOne, deleteMany, cancelar orden + GridFS
    │   ├── arrays.js             # Operadores $push, $pull, $addToSet
    │   └── projections.js        # Projections de inclusion, exclusion, y con paginacion
    ├── aggregations/
    │   └── pipelines.js          # 4 aggregation pipelines (simple + 3 complejas)
    ├── transactions/
    │   ├── crearPedido.js        # Transaccion 1: crear orden + ocupar mesa
    │   └── cerrarPedido.js       # Transaccion 2: pagar + PDF + liberar mesa + log
    ├── gridfs/
    │   └── comprobantes.js       # Subir, descargar, eliminar PDFs en GridFS
    └── menu/
        └── menu.js               # Menu interactivo en terminal con submenus
```

---

## Etapa 1 — Conexion a MongoDB Atlas

### Archivo: `src/db/connection.js`

Establece la conexion con MongoDB Atlas usando el driver nativo de Node.js.

| Funcion | Que hace |
|---------|----------|
| `conectar()` | Crea un `MongoClient` con la URI de Atlas, llama a `client.connect()` y selecciona la base de datos `restaurante_db`. Guarda las referencias en variables globales para reutilizar. |
| `getDb()` | Retorna la referencia a la base de datos (para que otros archivos no tengan que reconectarse). |
| `getClient()` | Retorna el cliente MongoDB (necesario para las transacciones que usan `startSession()`). |

**Patron usado:** Singleton de conexion — se conecta una sola vez y todos los modulos comparten la misma conexion.

### Archivo: `.env`

```
MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/
DB_NAME=restaurante_db
```

---

## Etapa 2 — Manejo de Errores Amigable

### Archivo: `src/db/errors.js`

Traduce los errores tecnicos de MongoDB a mensajes comprensibles en espanol.

| Funcion | Que hace |
|---------|----------|
| `manejarError(err, contexto)` | Recibe un error y un texto de contexto. Mapea codigos de error MongoDB a mensajes amigables. Retorna `null` para que la funcion que lo llame pueda retornar un valor seguro. |

**Codigos manejados:**
- `11000` → Duplicado (ej: email ya existe)
- `121` → Validacion de esquema fallida (muestra detalle del campo que fallo)
- `13` → Sin permisos
- `ECONNREFUSED` → MongoDB no esta corriendo
- `ETIMEOUT` → Problema de red
- `authentication` → Usuario/contraseña incorrectos

---

## Etapa 3 — Colecciones con JSON Schema Validation

### Archivo: `src/collections/createCollections.js`

Crea las 6 colecciones del sistema con validadores JSON Schema. Si la coleccion ya existe, la omite.

| Funcion | Que hace |
|---------|----------|
| `crearColecciones()` | Crea cada coleccion con `db.createCollection()` pasando un `$jsonSchema` validator. Usa `validationAction: 'error'` para que MongoDB rechace documentos invalidos. |

**Colecciones creadas:**

| Coleccion | Campos obligatorios | Reglas especiales |
|-----------|--------------------|--------------------|
| `restaurantes` | nombre, categoria, ubicacion, mesas, activo, created_at | ubicacion debe ser GeoJSON Point; mesas es array con minItems: 1 |
| `usuarios` | nombre, email, password_hash, rol, activo, created_at | rol solo puede ser 'cliente', 'mesero' o 'admin' (enum) |
| `menu_items` | restaurante_id, nombre, categoria, precio, disponible, created_at | precio debe ser number >= 0 |
| `ordenes` | restaurante_id, usuario_id, mesero_id, numero_mesa, estado, items, total, created_at | estado es enum de 5 valores; items array minItems: 1; total >= 0 |
| `resenas` | restaurante_id, usuario_id, calificacion, comentario, created_at | calificacion debe ser int entre 1 y 5 |
| `event_logs` | tipo, usuario_id, restaurante_id, timestamp | tipo es enum: login, orden_creada, pago, error |

**Nota:** Intenta activar `notablescan` pero lo maneja gracefully si falla (no funciona en Atlas Free Tier).

### Archivo: `src/collections/createIndexes.js`

| Funcion | Que hace |
|---------|----------|
| `crearIndices()` | Crea los 9 indices definidos en el documento de diseno. |
| `validarIndices()` | Lista todos los indices de cada coleccion para verificar que se crearon correctamente. |

**Los 9 indices:**

| # | Coleccion | Campo(s) | Tipo | Para que sirve |
|---|-----------|----------|------|----------------|
| 1 | usuarios | email | Unico | No permitir emails duplicados; acelerar login |
| 2 | ordenes | estado | Simple | Filtrar ordenes por estado (pendiente, pagado, etc.) |
| 3 | ordenes | restaurante_id + created_at | Compuesto | Ordenes de un restaurante ordenadas por fecha |
| 4 | menu_items | restaurante_id + categoria | Compuesto | Platillos de un restaurante filtrados por categoria |
| 5 | restaurantes | tags | Multikey | Buscar restaurantes por tags (cada elemento del array se indexa) |
| 6 | resenas | tags | Multikey | Buscar resenas por tags |
| 7 | restaurantes | ubicacion | 2dsphere | Busqueda geoespacial ($nearSphere) |
| 8 | menu_items | nombre + descripcion | Texto | Busqueda full-text de platillos |
| 9 | resenas | comentario | Texto | Busqueda full-text en comentarios |

---

## Etapa 4 — Seed de Datos Realistas

### Archivo: `src/seed/seed.js`

Genera datos de prueba con contexto guatemalteco usando @faker-js/faker.

| Funcion | Que hace |
|---------|----------|
| `generarRestaurantes()` | Crea 5 restaurantes con nombres, coordenadas reales de Ciudad de Guatemala, horarios y entre 3-8 mesas embebidas. |
| `generarUsuarios(restauranteIds)` | Crea 20 usuarios: 13 clientes (con preferencias embebidas), 5 meseros (asignados a restaurantes), 2 admins. |
| `generarMenuItems(restauranteIds)` | Crea 40 platillos (8 por restaurante: 2 por categoria). Incluye platillos tipicos guatemaltecos (Pepian, Kaq Ik, Jocon, etc.). |
| `generarOrdenes(...)` | Crea 100 ordenes con **patron snapshot** (copia nombre y precio al momento del pedido) y historial de estados embebido. |
| `generarResenas(...)` | Crea 80 resenas con calificaciones 1-5, tags y 30% con respuesta del restaurante embebida. |
| `ejecutarSeed()` | Funcion principal que limpia colecciones, inserta todo en orden correcto (respetando referencias entre colecciones) e inserta 50,000 event_logs en lotes de 1,000. |

**Cantidades finales:** 5 restaurantes, 20 usuarios, 40 menu_items, 100 ordenes, 80 resenas, 50,000 event_logs.

**Contraseña:** Todos los usuarios generados por el seed tienen `password_hash: '1234'` para poder hacer login desde el menu interactivo.

---

## Etapa 5 — CRUD: Create

### Archivo: `src/crud/create.js`

| Funcion | Que hace |
|---------|----------|
| `crearRestaurante(datos)` | Inserta un restaurante con mesas embebidas generadas automaticamente, ubicacion GeoJSON Point y horario semanal. |
| `crearUsuario(datos)` | Inserta un usuario. Si es cliente, agrega preferencias embebidas (alergias, dieta). Si es mesero/admin, agrega restaurante_id. |
| `crearMenuItem(datos)` | Inserta un platillo al menu de un restaurante con nombre, categoria, precio, ingredientes. |
| `crearOrden(restauranteId, clienteId, meseroId, numeroMesa, itemsCarrito)` | Inserta una orden usando **patron snapshot**: copia nombre y precio de cada platillo al momento del pedido. Calcula subtotales y total. Inicializa historial_estados. |
| `crearResena(datos)` | Inserta una resena con calificacion (Int32 1-5), comentario y tags. |

**Concepto clave — Snapshot Pattern:** Al crear una orden, se copian nombre y precio de cada platillo en el momento. Si despues el precio cambia en el menu, la orden historica no se afecta.

---

## Etapa 5 — CRUD: Read

### Archivo: `src/crud/read.js`

| Funcion | Que hace |
|---------|----------|
| `restaurantesCercanos(lat, lng, distancia)` | Usa `$nearSphere` con el indice 2dsphere para encontrar restaurantes cerca de una coordenada, ordenados por distancia. |
| `menuPorCategoria(restauranteId, categoria)` | Consulta platillos disponibles de una categoria con **projection de inclusion** (solo nombre, precio, categoria). |
| `ordenesPorRestaurante(restauranteId, pagina, limite)` | Lista ordenes con **paginacion** (skip + limit) y projection que excluye el array de items para optimizar. |
| `buscarPlatillos(textoBusqueda)` | Busqueda **full-text** usando `$text` con el indice de texto. Ordena por relevancia (`$meta: 'textScore'`). |
| `lookupOrdenesConDetalle(restauranteId)` | Usa `$lookup` (equivalente a JOIN en SQL) para unir ordenes con info del cliente y del restaurante en una sola consulta. |

---

## Etapa 5 — CRUD: Update

### Archivo: `src/crud/update.js`

| Funcion | Que hace |
|---------|----------|
| `actualizarEstadoOrden(ordenId, nuevoEstado, meseroId)` | Usa `$set` para cambiar el estado y `$push` para agregar al historial embebido en una sola operacion atomica. |
| `deshabilitarCategoriaMenu(restauranteId, categoria)` | Usa `updateMany` para marcar como no disponibles TODOS los platillos de una categoria de un restaurante. |
| `actualizarPrecioMenuItem(menuItemId, nuevoPrecio)` | Usa `updateOne` con `$set` para cambiar el precio. Las ordenes existentes no se afectan (snapshot). |
| `responderResena(resenaId, textoRespuesta)` | Usa `$set` para agregar/actualizar el subdocumento embebido `respuesta_restaurante` dentro de la resena. |

---

## Etapa 5 — CRUD: Delete

### Archivo: `src/crud/delete.js`

| Funcion | Que hace |
|---------|----------|
| `eliminarMenuItem(menuItemId)` | Usa `deleteOne` para eliminar un platillo del menu. |
| `eliminarResenasUsuario(usuarioId)` | Usa `deleteMany` para eliminar TODAS las resenas de un usuario (cuando se da de baja). |
| `cancelarOrden(ordenId)` | Busca la orden, elimina su PDF de GridFS si tiene uno, y luego elimina la orden con `deleteOne`. |

---

## Etapa 6 — Manejo de Arrays

### Archivo: `src/crud/arrays.js`

Operadores atomicos para manipular arrays dentro de documentos sin leer-modificar-escribir.

| Funcion | Operador | Que hace |
|---------|----------|----------|
| `agregarItemAOrden(ordenId, nuevoItem)` | `$push` | Agrega un item al final del array `items` de una orden. Permite duplicados. |
| `registrarCambioEstado(ordenId, nuevoEstado, usuarioId)` | `$push` | Agrega un nuevo registro al array `historial_estados` con estado, timestamp y quien hizo el cambio. |
| `quitarTagRestaurante(restauranteId, tag)` | `$pull` | Elimina TODAS las ocurrencias de un tag del array `tags` del restaurante. |
| `agregarTagResena(resenaId, tag)` | `$addToSet` | Agrega un tag a la resena SOLO si no existe ya (evita duplicados). |
| `agregarTagRestaurante(restauranteId, tag)` | `$addToSet` | Agrega un tag al restaurante sin duplicar. |

**Diferencia clave:**
- `$push` → siempre agrega (permite duplicados)
- `$addToSet` → solo agrega si no existe ya
- `$pull` → elimina por valor

---

## Etapa 7 — Projections

### Archivo: `src/crud/projections.js`

Controlan que campos se retornan en una consulta para reducir trafico de red.

| Funcion | Tipo | Que hace |
|---------|------|----------|
| `projectionMenuSimple(restauranteId)` | Inclusion | Trae SOLO nombre, precio y categoria. Excluye _id con `{ _id: 0 }`. Ordena por precio ascendente. |
| `projectionOrdenesSinItems(restauranteId, pagina, limite)` | Inclusion + Paginacion | Trae numero_mesa, estado, total, created_at. NO trae el array items (puede ser grande). Combina con skip/limit para paginar. |
| `projectionUsuarioSinPassword(filtro)` | Exclusion | Trae TODOS los campos MENOS password_hash con `{ password_hash: 0 }`. El frontend nunca debe recibir el hash. |

**Regla de projections:** No se pueden mezclar inclusion y exclusion en la misma projection, EXCEPTO con `_id` (se puede hacer `{ nombre: 1, _id: 0 }`).

---

## Etapa 8 — Aggregation Pipelines

### Archivo: `src/aggregations/pipelines.js`

Procesan documentos en etapas secuenciales, como una linea de produccion.

| Funcion | Complejidad | Pipeline | Que hace |
|---------|-------------|----------|----------|
| `conteoOrdenesPorEstado(restauranteId)` | Simple | `$match` → `$group` → `$sort` | Cuenta cuantas ordenes hay en cada estado para un restaurante. |
| `top5Platillos()` | Compleja | `$match` → `$unwind` → `$group` → `$sort` → `$limit` → `$lookup` → `$project` | Encuentra los 5 platillos mas vendidos. `$unwind` "explota" el array items para poder agrupar por platillo. `$lookup` trae info adicional de menu_items. |
| `restaurantesMejorCalificados()` | Compleja | `$group` → `$match` → `$lookup` → `$unwind` → `$project` → `$sort` → `$limit` | Ranking de restaurantes por calificacion promedio. Solo incluye los que tienen 5+ resenas. `$avg` calcula el promedio. |
| `ingresosPorPeriodo(fechaInicio, fechaFin)` | Compleja | `$match` → `$group` → `$lookup` → `$project` → `$sort` | Calcula ingresos totales, cantidad de ordenes y ticket promedio por restaurante en un rango de fechas. |

**Operadores clave:**
- `$match` → filtra (como WHERE en SQL)
- `$group` → agrupa y calcula (como GROUP BY)
- `$unwind` → explota arrays (1 doc con 3 items → 3 docs)
- `$lookup` → une colecciones (como JOIN)
- `$project` → selecciona campos del resultado
- `$sort` / `$limit` → ordena y limita

---

## Etapa 9 — Transacciones Multi-Documento

### Archivo: `src/transactions/crearPedido.js`

| Funcion | Que hace |
|---------|----------|
| `crearPedidoAtomico(restauranteId, clienteId, meseroId, numeroMesa, itemsCarrito)` | **Transaccion 1** — Ejecuta 2 operaciones atomicas: (1) Inserta la orden en `ordenes`, (2) Marca la mesa como ocupada en `restaurantes`. Si cualquiera falla, revierte todo con `abortTransaction()`. Usa `session.startTransaction()` / `commitTransaction()` / `abortTransaction()`. |

### Archivo: `src/transactions/cerrarPedido.js`

| Funcion | Que hace |
|---------|----------|
| `generarPDFComprobante(orden, restauranteNombre)` | Genera un PDF con pdf-lib que contiene: encabezado con nombre del restaurante, datos de la orden (mesa, fecha, metodo de pago), detalle de cada item con subtotales, y total. Retorna un Buffer. |
| `cerrarPedidoAtomico(ordenId, metodoPago)` | **Transaccion 2** — (1) Genera el PDF y lo sube a GridFS (ANTES de la transaccion porque GridFS no soporta transacciones), (2) Actualiza la orden a 'pagado' + guarda ID del PDF + agrega al historial, (3) Libera la mesa, (4) Registra evento de pago en event_logs. Si la transaccion falla, elimina el PDF para no dejar basura. |

**Concepto clave:** GridFS no soporta transacciones de MongoDB. Por eso el PDF se sube primero y se limpia manualmente si la transaccion falla.

---

## Etapa 10 — GridFS

### Archivo: `src/gridfs/comprobantes.js`

GridFS divide archivos en chunks de 255KB y los almacena en 2 colecciones: `comprobantes.files` (metadatos) y `comprobantes.chunks` (contenido binario).

| Funcion | Que hace |
|---------|----------|
| `subirComprobante(ordenId, restauranteId, pdfBuffer)` | Abre un stream de escritura con `bucket.openUploadStream()`, escribe el buffer del PDF, y retorna el `_id` del archivo en GridFS. Guarda metadata (orden_id, restaurante_id). |
| `descargarComprobante(comprobantePdfId, destStream)` | Abre un stream de lectura con `bucket.openDownloadStream()` y hace pipe al stream de destino (puede ser archivo o respuesta HTTP). |
| `descargarComoBuffer(comprobantePdfId)` | Descarga un PDF y lo retorna como Buffer en memoria. Recolecta chunks con eventos 'data' y los une con `Buffer.concat()`. |
| `eliminarComprobante(comprobantePdfId)` | Elimina el archivo de GridFS con `bucket.delete()`. Borra automaticamente tanto `.files` como `.chunks`. |
| `listarComprobantes()` | Lista todos los PDFs almacenados mostrando nombre, tamano y fecha de subida. |

---

## Etapa 11 — Menu Interactivo con Login y Roles

### Archivo: `src/menu/menu.js`

Menu en terminal con sistema de autenticacion y menus diferenciados por rol.

### Sistema de Login

| Funcion | Que hace |
|---------|----------|
| `pantallaLogin()` | Pantalla inicial con 3 opciones: iniciar sesion (email + contraseña), registrarse como cliente, ver usuarios demo. Valida credenciales contra la BD y carga el restaurante si es mesero/admin. |
| `main()` | Funcion principal: conecta a MongoDB, muestra login, redirige al menu segun rol, y al cerrar sesion permite volver a loguearse. |

**Credenciales demo:** Todos los usuarios del seed tienen contraseña `1234`. Opcion 3 del login lista emails por rol.

### Helpers

| Funcion | Que hace |
|---------|----------|
| `obtenerRestaurante()` | Si el usuario es admin/mesero, retorna automaticamente su restaurante. Si es cliente, muestra lista para elegir. |
| `obtenerOrden(filtro)` | Lista ordenes con nombre de restaurante ($lookup). Si es admin/mesero, filtra solo las de su restaurante. |

### Menu CLIENTE (7 opciones)

Puede interactuar con cualquier restaurante.

| Opcion | Funcion | Que hace |
|--------|---------|----------|
| 1 | Buscar restaurantes cercanos | $nearSphere con coordenadas y radio en metros |
| 2 | Ver menu de un restaurante | Elige restaurante, luego categoria → muestra platillos |
| 3 | Buscar platillos (full-text) | $text search en nombre y descripcion |
| 4 | Hacer pedido | Elige restaurante → selecciona platillos → elige mesa → crea orden con snapshot |
| 5 | Dejar resena | Elige restaurante → calificacion 1-5 + comentario |
| 6 | Ver mis ordenes | $lookup para mostrar ordenes del cliente con nombre de restaurante |

### Menu MESERO (8 opciones)

Solo ve y modifica datos de **su** restaurante.

| Opcion | Funcion | Que hace |
|--------|---------|----------|
| 1 | Ver ordenes del restaurante | ordenesPorRestaurante con paginacion |
| 2 | Actualizar estado de orden | Cambia estado + registra en historial con su usuario_id |
| 3 | Crear pedido | Transaccion atomica: orden + ocupar mesa |
| 4 | Cerrar pedido | Transaccion atomica: pagar + PDF + liberar mesa + log |
| 5 | Ver menu del restaurante | menuPorCategoria de su restaurante |
| 6 | Agregar item a orden ($push) | Selecciona platillo del menu y lo agrega a una orden |
| 7 | Registrar cambio de estado ($push) | Agrega al historial_estados de una orden |

### Menu ADMIN (11 opciones + submenus)

Acceso completo, pero todo scoped a **su** restaurante.

| Opcion | Submenu | Opciones |
|--------|---------|----------|
| 1 | Gestion del Menu | Ver por categoria, crear item, actualizar precio, deshabilitar categoria, eliminar item |
| 2 | Ordenes | Ver paginadas, actualizar estado, cancelar orden, lookup con detalle |
| 3 | Transacciones | Crear pedido atomico, cerrar pedido atomico |
| 4 | Aggregation Pipelines | Conteo por estado, top 5 platillos, restaurantes mejor calificados, ingresos por periodo, ejecutar todos |
| 5 | GridFS | Listar, subir, descargar, eliminar comprobantes PDF |
| 6 | Arrays | $push item/historial, $pull tag, $addToSet tag resena/restaurante |
| 7 | Projections | Inclusion simple, inclusion+paginacion, exclusion |
| 8 | Indices y explain() | Ver indices, explain ordenes (IXSCAN), explain geo, explain texto |
| 9 | Resenas | Ver resenas, responder resena, eliminar resenas de usuario |
| 10 | Seed | Regenerar todos los datos de prueba |
| 11 | Setup | Crear colecciones + indices |

### Flujo de autenticacion

```
Login → email + contraseña
  ├─ cliente  → menuCliente()  → puede elegir cualquier restaurante
  ├─ mesero   → menuMesero()   → solo su restaurante (auto-asignado)
  └─ admin    → menuAdmin()    → solo su restaurante (con todas las herramientas)
```

---

## Etapa 12 — Validacion Final

### Archivo: `test_validacion_final.js`

Script automatizado que verifica que TODAS las funcionalidades del proyecto funcionan correctamente.

**10 categorias verificadas (48 checks):**

| # | Categoria | Checks | Que verifica |
|---|-----------|--------|-------------|
| 1 | Colecciones | 6 | Las 6 colecciones existen y tienen JSON Schema validator |
| 2 | Indices | 9 | Los 9 indices existen con las propiedades correctas (unico, compuesto, 2dsphere, texto) |
| 3 | Datos Seed | 6 | Cantidades minimas: 5 restaurantes, 20 usuarios, 40 menu_items, 100 ordenes, 80 resenas, 50,000 event_logs |
| 4 | CRUD | 4 | Create (insertar), Read (full-text), Update (precio), Delete (eliminar item) |
| 5 | Transacciones | 5 | Crear pedido + mesa ocupada, cerrar pedido + PDF + mesa liberada + log de pago |
| 6 | Aggregations | 4 | Las 4 pipelines retornan resultados |
| 7 | Explain | 3 | ordenes usa IXSCAN, $nearSphere usa GEO_NEAR_2DSPHERE, $text usa TEXT_MATCH |
| 8 | GridFS | 3 | Subir PDF, descargar PDF valido, eliminar PDF |
| 9 | Arrays | 4 | $addToSet agrega, $addToSet no duplica, $pull elimina, $addToSet en resena |
| 10 | Projections | 3 | Inclusion simple (sin _id), inclusion+paginacion (sin items), exclusion (sin password_hash) |

**Resultado:** 48/48 verificaciones aprobadas.

---

## Decisiones de Diseno

### Documentos Embebidos vs Referencias

| Embebido (dentro del documento) | Referencia (en coleccion separada) |
|--------------------------------|-----------------------------------|
| `mesas` dentro de `restaurantes` (siempre se consultan juntas) | `menu_items` referencia a `restaurantes` via `restaurante_id` |
| `items` (snapshot) dentro de `ordenes` (historico inmutable) | `ordenes` referencia a `usuarios` via `usuario_id` y `mesero_id` |
| `historial_estados` dentro de `ordenes` (trazabilidad) | `resenas` referencia a `restaurantes` y `usuarios` |
| `preferencias` dentro de `usuarios` (datos personales) | `event_logs` referencia a `usuarios` y `restaurantes` |
| `respuesta_restaurante` dentro de `resenas` (1:1) | |
| `horario` dentro de `restaurantes` (datos del negocio) | |

### Patron Snapshot

En la coleccion `ordenes`, los items se guardan como **copia** del nombre y precio al momento del pedido. Si despues cambia el precio en el menu, las ordenes historicas no se afectan. Esto es fundamental para la integridad de los datos financieros.

### Hashing de Contraseñas

Las contraseñas se hashean con **bcryptjs** (10 rondas de salt) antes de almacenarse. En el login se usa `bcrypt.compare()` para validar sin exponer el hash. Los usuarios del seed tienen contraseña `1234` (almacenada como hash bcrypt, no en texto plano).

---

## Como Ejecutar

```bash
# Instalar dependencias
npm install

# Setup inicial (crear colecciones + indices)
node src/collections/createCollections.js
node src/collections/createIndexes.js

# Llenar con datos de prueba
node src/seed/seed.js

# Ejecutar menu interactivo
node src/menu/menu.js

# Ejecutar validacion final
node test_validacion_final.js
```

---

## Dependencias

| Paquete | Version | Para que se usa |
|---------|---------|-----------------|
| `mongodb` | ^7.1.0 | Driver nativo de MongoDB para Node.js |
| `dotenv` | ^17.3.1 | Cargar variables de entorno desde .env |
| `pdf-lib` | ^1.17.1 | Generar PDFs de comprobantes de pago |
| `@faker-js/faker` | ^10.3.0 | Generar datos de prueba realistas |
| `bcryptjs` | ^3.0.2 | Hashing seguro de contraseñas (bcrypt) |
