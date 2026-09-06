/**
 * Starts a throwaway local MongoDB on a fixed port for development and
 * verification runs on machines without a MongoDB install.
 *
 * Usage: node scripts/dev-mongo.mjs   (leave running, Ctrl+C to stop)
 * Point MONGODB_URI at mongodb://127.0.0.1:27017/watchpoint
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create({
  instance: { port: 27017, dbName: 'watchpoint' },
});

console.log('Dev MongoDB running at', server.getUri());

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
