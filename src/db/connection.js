// Importamos dotenv para leer el archivo .env con la URI y nombre de la BD
require('dotenv').config();
const { MongoClient } = require('mongodb');

// Leemos las variables de entorno
const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;

// Variables globales para reutilizar la conexión en todo el proyecto
let client, db;

/**
 * conectar() — establece la conexión con MongoDB Atlas.
 * MongoClient es el objeto principal del driver de Node.js.
 * Una vez conectado, guardamos las referencias en 'client' y 'db'
 * para no reconectarnos cada vez que hagamos una operación.
 */
async function conectar() {
  // Creamos el cliente con la URI de Atlas
  client = new MongoClient(uri);
  // connect() es async — esperamos a que se establezca la conexión
  await client.connect();
  // Seleccionamos la base de datos 'restaurante_db'
  db = client.db(dbName);
  console.log('Conectado a MongoDB:', dbName);
  return { client, db };
}

// getDb() y getClient() permiten que otros archivos accedan a la conexión
// sin tener que reconectarse cada vez
module.exports = { conectar, getDb: () => db, getClient: () => client };
