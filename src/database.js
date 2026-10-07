import { MongoClient } from 'mongodb';
import { STUDENT, escapeRegex } from './rules.js';

// Hai pool ket noi rieng. Read/write duoc dinh tuyen theo tung thao tac.
export async function connectDatabase(config) {
  const options = { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 };
  const readClient = new MongoClient(config.readUri, options);
  const writeClient = new MongoClient(config.writeUri, options);
  const connections = await Promise.allSettled([readClient.connect(), writeClient.connect()]);
  if (connections.some((result) => result.status === 'rejected')) {
    await Promise.allSettled([readClient.close(), writeClient.close()]);
    throw new Error('Khong ket noi duoc Atlas. Kiem tra URI, user va Network Access.');
  }
  const readDb = readClient.db(STUDENT.database);
  const writeDb = writeClient.db(STUDENT.database);
  return {
    async listBooks(search, page) {
      const pattern = escapeRegex(search);
      const filter = search ? { $or: [
        { code: { $regex: pattern, $options: 'i' } },
        { title: { $regex: pattern, $options: 'i' } },
        { author: { $regex: pattern, $options: 'i' } }
      ] } : {};
      return readDb.collection('books').find(filter)
        .sort({ createdAt: -1, _id: 1 }).skip((page - 1) * 20).limit(21)
        .maxTimeMS(5000).toArray();
    },
    async insertBook(book) {
      // insertOne khong doc lai ban ghi bang tai khoan Ghi.
      return writeDb.collection('books').insertOne(book);
    },
    async getSession(sid) {
      return readDb.collection('sessions').findOne({ _id: sid, expiresAt: { $gt: new Date() } });
    },
    async setSession(sid, data, expiresAt) {
      return writeDb.collection('sessions').updateOne(
        { _id: sid }, { $set: { data, expiresAt } }, { upsert: true }
      );
    },
    async touchSession(sid, expiresAt) {
      return writeDb.collection('sessions').updateOne({ _id: sid }, { $set: { expiresAt } });
    },
    async destroySession(sid) {
      return writeDb.collection('sessions').deleteOne({ _id: sid });
    },
    async checkHealth() {
      await Promise.all([readDb.command({ ping: 1 }), writeDb.command({ ping: 1 })]);
      await readDb.collection('books').findOne({}, { projection: { _id: 1 }, maxTimeMS: 3000 });
    },
    async close() {
      await Promise.allSettled([readClient.close(), writeClient.close()]);
    }
  };
}
