const { GridFSBucket } = require('mongodb');
const { getDb } = require('../db/connection');
const { manejarError } = require('../db/errors');

/**
 * GridFS divide archivos grandes en chunks de 255KB y los almacena en 2 colecciones:
 *   - comprobantes.files  → metadatos (nombre, tamaño, fecha, metadata custom)
 *   - comprobantes.chunks → contenido binario dividido en pedazos
 *
 * MongoDB tiene un límite de 16MB por documento. GridFS permite almacenar
 * archivos más grandes dividiéndolos automáticamente.
 */

/**
 * subirComprobante(ordenId, restauranteId, pdfBuffer) — sube un PDF a GridFS.
 * Retorna el _id del archivo para guardarlo en la orden.
 *
 * @param {ObjectId} ordenId - ID de la orden asociada
 * @param {ObjectId} restauranteId - ID del restaurante
 * @param {Buffer} pdfBuffer - Contenido binario del PDF
 * @returns {ObjectId|null} - _id del archivo en GridFS
 */
async function subirComprobante(ordenId, restauranteId, pdfBuffer) {
  try {
    // Creamos un bucket con nombre 'comprobantes'
    // Esto crea las colecciones comprobantes.files y comprobantes.chunks
    const bucket = new GridFSBucket(getDb(), { bucketName: 'comprobantes' });

    return new Promise((resolve, reject) => {
      // openUploadStream abre un stream de escritura hacia GridFS
      const stream = bucket.openUploadStream(`comprobante_${ordenId}.pdf`, {
        // metadata permite guardar info adicional junto al archivo
        metadata: { orden_id: ordenId, restaurante_id: restauranteId }
      });

      // Escribimos el buffer completo y cerramos el stream
      stream.end(pdfBuffer);

      // 'finish' se emite cuando GridFS terminó de guardar todos los chunks
      stream.on('finish', () => {
        console.log(`PDF subido a GridFS | _id: ${stream.id} | archivo: comprobante_${ordenId}.pdf`);
        resolve(stream.id);
      });

      stream.on('error', (err) => reject(err));
    });
  } catch (err) {
    return manejarError(err, 'subir comprobante PDF a GridFS');
  }
}

/**
 * descargarComprobante(comprobantePdfId, destStream) — descarga un PDF desde GridFS.
 * Hace pipe del contenido al stream de destino (puede ser un archivo o respuesta HTTP).
 *
 * @param {ObjectId} comprobantePdfId - _id del archivo en GridFS
 * @param {WritableStream} destStream - Stream donde escribir el PDF (ej: fs.createWriteStream o res de HTTP)
 * @returns {Promise<void>}
 */
async function descargarComprobante(comprobantePdfId, destStream) {
  try {
    const bucket = new GridFSBucket(getDb(), { bucketName: 'comprobantes' });

    return new Promise((resolve, reject) => {
      // openDownloadStream lee los chunks y los une en orden
      const downloadStream = bucket.openDownloadStream(comprobantePdfId);

      // pipe() conecta el stream de lectura con el de escritura
      downloadStream.pipe(destStream);

      downloadStream.on('end', () => {
        console.log('PDF descargado correctamente desde GridFS');
        resolve();
      });

      downloadStream.on('error', (err) => reject(err));
    });
  } catch (err) {
    return manejarError(err, 'descargar comprobante PDF de GridFS');
  }
}

/**
 * descargarComoBuffer(comprobantePdfId) — descarga un PDF y lo retorna como Buffer.
 * Útil cuando no tenemos un stream de destino (ej: para mostrarlo en consola o reenviarlo).
 *
 * @param {ObjectId} comprobantePdfId - _id del archivo en GridFS
 * @returns {Buffer|null} - Contenido del PDF como Buffer
 */
async function descargarComoBuffer(comprobantePdfId) {
  try {
    const bucket = new GridFSBucket(getDb(), { bucketName: 'comprobantes' });

    return new Promise((resolve, reject) => {
      const chunks = [];
      const downloadStream = bucket.openDownloadStream(comprobantePdfId);

      // Recolectamos cada chunk de datos que llega
      downloadStream.on('data', (chunk) => chunks.push(chunk));

      // Al terminar, unimos todos los chunks en un solo Buffer
      downloadStream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`PDF descargado como buffer | Tamano: ${(buffer.length / 1024).toFixed(1)} KB`);
        resolve(buffer);
      });

      downloadStream.on('error', (err) => reject(err));
    });
  } catch (err) {
    return manejarError(err, 'descargar comprobante como buffer');
  }
}

/**
 * eliminarComprobante(comprobantePdfId) — elimina un PDF de GridFS.
 * Borra automáticamente tanto el documento en .files como los chunks en .chunks.
 *
 * @param {ObjectId} comprobantePdfId - _id del archivo en GridFS
 * @returns {boolean} - true si se eliminó correctamente
 */
async function eliminarComprobante(comprobantePdfId) {
  try {
    const bucket = new GridFSBucket(getDb(), { bucketName: 'comprobantes' });
    // delete() elimina el archivo y TODOS sus chunks asociados
    await bucket.delete(comprobantePdfId);
    console.log('PDF eliminado de GridFS correctamente | _id:', comprobantePdfId);
    return true;
  } catch (err) {
    manejarError(err, 'eliminar comprobante PDF de GridFS');
    return false;
  }
}

/**
 * listarComprobantes() — lista todos los PDFs almacenados en GridFS.
 * Muestra nombre, tamaño y metadata de cada archivo.
 *
 * @returns {Array} - Lista de archivos en GridFS
 */
async function listarComprobantes() {
  try {
    const bucket = new GridFSBucket(getDb(), { bucketName: 'comprobantes' });
    // find() en el bucket busca en la colección comprobantes.files
    const archivos = await bucket.find().toArray();

    if (archivos.length === 0) {
      console.log('No hay comprobantes PDF en GridFS');
    } else {
      console.log(`Comprobantes en GridFS (${archivos.length}):`);
      archivos.forEach(a => {
        const tamano = (a.length / 1024).toFixed(1);
        console.log(`  - ${a.filename} | ${tamano} KB | subido: ${a.uploadDate.toLocaleDateString()}`);
      });
    }

    return archivos;
  } catch (err) {
    return manejarError(err, 'listar comprobantes') || [];
  }
}

module.exports = {
  subirComprobante,
  descargarComprobante,
  descargarComoBuffer,
  eliminarComprobante,
  listarComprobantes
};
