/**
 * errors.js — Manejo centralizado de errores amigables en español.
 * Traduce los errores técnicos de MongoDB a mensajes comprensibles.
 */

// Mapa de códigos de error de MongoDB a mensajes amigables
const ERRORES_MONGO = {
  11000: 'Ya existe un registro con ese valor (duplicado). Verifica que no estés insertando datos repetidos.',
  121: 'El documento no cumple con la validacion del esquema. Revisa que todos los campos obligatorios esten presentes y tengan el tipo correcto.',
  13: 'No tienes permisos para realizar esta operacion en la base de datos.',
  2: 'La operacion solicitada no es valida. Verifica los parametros enviados.',
};

/**
 * manejarError(err, contexto) — recibe un error y un texto de contexto,
 * muestra un mensaje amigable en español en la consola.
 * @param {Error} err - El error capturado
 * @param {string} contexto - Descripcion de qué se estaba haciendo (ej: 'crear restaurante')
 * @returns {null} - Retorna null para que la función que lo llame pueda retornar un valor seguro
 */
function manejarError(err, contexto = 'operacion') {
  console.error(`\n[ERROR] Fallo al ${contexto}:`);

  // Si es un error de MongoDB con código conocido
  if (err.code && ERRORES_MONGO[err.code]) {
    console.error(`  -> ${ERRORES_MONGO[err.code]}`);
  } else if (err.code) {
    console.error(`  -> Error de MongoDB (codigo ${err.code}): ${err.message}`);
  } else if (err.message && err.message.includes('ECONNREFUSED')) {
    console.error('  -> No se pudo conectar a MongoDB. Verifica que el servidor este corriendo.');
  } else if (err.message && err.message.includes('ETIMEOUT')) {
    console.error('  -> La conexion a MongoDB tardo demasiado. Verifica tu conexion a internet.');
  } else if (err.message && err.message.includes('authentication')) {
    console.error('  -> Error de autenticacion. Verifica usuario y contraseña en el archivo .env');
  } else {
    console.error(`  -> ${err.message}`);
  }

  // Mostrar detalle técnico solo si es un error de validación de esquema
  if (err.code === 121 && err.errInfo) {
    console.error('  -> Detalle:', JSON.stringify(err.errInfo.details, null, 2));
  }

  return null;
}

module.exports = { manejarError };
