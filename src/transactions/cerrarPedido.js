const { getDb, getClient } = require('../db/connection');
const { manejarError } = require('../db/errors');
const { ObjectId, GridFSBucket } = require('mongodb');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * generarPDFComprobante(orden, restauranteNombre) — genera un PDF con el detalle de la orden.
 * Usa pdf-lib para crear el documento. Retorna un Buffer con el contenido del PDF.
 *
 * @param {Object} orden - Documento de la orden con items embebidos
 * @param {string} restauranteNombre - Nombre del restaurante
 * @returns {Buffer} - Buffer con el contenido binario del PDF
 */
async function generarPDFComprobante(orden, restauranteNombre) {
  // Creamos un nuevo documento PDF vacío
  const pdfDoc = await PDFDocument.create();
  const pagina = pdfDoc.addPage([400, 600]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 560; // posición vertical inicial (de arriba hacia abajo)

  // --- Encabezado ---
  pagina.drawText(restauranteNombre, { x: 50, y, font: fontBold, size: 18, color: rgb(0.1, 0.1, 0.5) });
  y -= 25;
  pagina.drawText('COMPROBANTE DE PAGO', { x: 50, y, font: fontBold, size: 14 });
  y -= 20;
  pagina.drawText('-'.repeat(50), { x: 50, y, font, size: 10 });
  y -= 20;

  // --- Datos de la orden ---
  pagina.drawText(`Orden: ${orden._id}`, { x: 50, y, font, size: 9 });
  y -= 15;
  pagina.drawText(`Mesa: ${orden.numero_mesa}`, { x: 50, y, font, size: 10 });
  y -= 15;
  pagina.drawText(`Fecha: ${new Date().toLocaleString()}`, { x: 50, y, font, size: 10 });
  y -= 15;
  pagina.drawText(`Metodo de pago: ${orden.metodo_pago || 'tarjeta'}`, { x: 50, y, font, size: 10 });
  y -= 20;
  pagina.drawText('-'.repeat(50), { x: 50, y, font, size: 10 });
  y -= 20;

  // --- Detalle de items ---
  pagina.drawText('DETALLE:', { x: 50, y, font: fontBold, size: 11 });
  y -= 18;

  for (const item of orden.items) {
    pagina.drawText(`${item.cantidad}x ${item.nombre}`, { x: 50, y, font, size: 10 });
    pagina.drawText(`Q${item.subtotal.toFixed(2)}`, { x: 300, y, font, size: 10 });
    y -= 15;
    if (item.notas) {
      pagina.drawText(`   Nota: ${item.notas}`, { x: 50, y, font, size: 8, color: rgb(0.4, 0.4, 0.4) });
      y -= 12;
    }
  }

  // --- Total ---
  y -= 10;
  pagina.drawText('-'.repeat(50), { x: 50, y, font, size: 10 });
  y -= 20;
  pagina.drawText(`TOTAL: Q${orden.total.toFixed(2)}`, { x: 50, y, font: fontBold, size: 14 });
  y -= 30;
  pagina.drawText('Gracias por su visita!', { x: 50, y, font, size: 10, color: rgb(0.3, 0.3, 0.3) });

  // Convertimos el PDF a bytes (Uint8Array) y luego a Buffer
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * cerrarPedidoAtomico(ordenId, metodoPago)
 *
 * Transacción que realiza 4 operaciones al cerrar un pedido:
 *   1. Genera y sube el comprobante PDF a GridFS (ANTES de la transacción)
 *   2. Actualiza la orden: estado='pagado', guarda el ID del PDF, agrega al historial
 *   3. Libera la mesa (mesas.$.disponible = true)
 *   4. Registra el evento de pago en event_logs
 *
 * NOTA: GridFS no soporta transacciones, por eso el PDF se sube primero.
 * Si la transacción falla, se elimina el PDF para no dejar basura.
 *
 * @param {ObjectId} ordenId - ID de la orden a cerrar
 * @param {string} metodoPago - 'efectivo'|'tarjeta'|'transferencia'
 * @returns {ObjectId|null} - ID del comprobante PDF en GridFS
 */
async function cerrarPedidoAtomico(ordenId, metodoPago = 'tarjeta') {
  const client = getClient();
  const db = getDb();

  // Buscamos la orden completa para generar el PDF
  const orden = await db.collection('ordenes').findOne({ _id: ordenId });
  if (!orden) {
    console.log('No se encontro la orden para cerrar');
    return null;
  }

  if (orden.estado === 'pagado') {
    console.log('Esta orden ya fue pagada');
    return null;
  }

  // Buscamos el nombre del restaurante para el comprobante
  const restaurante = await db.collection('restaurantes').findOne({ _id: orden.restaurante_id });
  const restauranteNombre = restaurante ? restaurante.nombre : 'Restaurante';

  // --- Paso 1: Generar PDF y subirlo a GridFS ---
  // GridFS NO soporta transacciones, por eso se hace ANTES
  const pdfBuffer = await generarPDFComprobante(orden, restauranteNombre);
  const bucket = new GridFSBucket(db, { bucketName: 'comprobantes' });

  // Subimos el PDF usando un stream de escritura
  const comprobantePdfId = await new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(`comprobante_${ordenId}.pdf`, {
      metadata: { orden_id: ordenId, restaurante_id: orden.restaurante_id }
    });
    stream.end(pdfBuffer);
    stream.on('finish', () => resolve(stream.id));
    stream.on('error', reject);
  });

  // --- Paso 2: Transacción para las 3 operaciones MongoDB ---
  const session = client.startSession();
  try {
    session.startTransaction();

    // 2a. Actualizar orden: estado=pagado, guardar ID del PDF, agregar al historial
    await db.collection('ordenes').updateOne(
      { _id: ordenId },
      {
        $set: {
          estado: 'pagado',
          metodo_pago: metodoPago,
          comprobante_pdf_id: comprobantePdfId,
          updated_at: new Date()
        },
        $push: {
          historial_estados: { estado: 'pagado', timestamp: new Date() }
        }
      },
      { session }
    );

    // 2b. Liberar la mesa — el operador $ apunta a la mesa que coincide
    await db.collection('restaurantes').updateOne(
      { _id: orden.restaurante_id, 'mesas.numero': orden.numero_mesa },
      { $set: { 'mesas.$.disponible': true } },
      { session }
    );

    // 2c. Registrar evento de pago en los logs
    await db.collection('event_logs').insertOne(
      {
        tipo: 'pago',
        usuario_id: orden.usuario_id,
        restaurante_id: orden.restaurante_id,
        detalle: `Orden ${ordenId} pagada con ${metodoPago} por Q${orden.total}`,
        timestamp: new Date()
      },
      { session }
    );

    // Confirmar todos los cambios
    await session.commitTransaction();

    console.log('Pedido cerrado exitosamente:');
    console.log(`  Orden: ${ordenId}`);
    console.log(`  Estado: pagado | Metodo: ${metodoPago} | Total: Q${orden.total}`);
    console.log(`  Mesa ${orden.numero_mesa} liberada`);
    console.log(`  PDF guardado en GridFS: ${comprobantePdfId}`);
    return comprobantePdfId;

  } catch (err) {
    // Revertir la transacción
    await session.abortTransaction();
    // Limpiar el PDF que ya se subió (para no dejar basura en GridFS)
    await bucket.delete(comprobantePdfId).catch(() => {});
    manejarError(err, 'cerrar pedido atomico (transaccion revertida)');
    return null;
  } finally {
    session.endSession();
  }
}

module.exports = { cerrarPedidoAtomico, generarPDFComprobante };
