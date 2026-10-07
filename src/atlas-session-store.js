import session from 'express-session';

const SESSION_TTL = 2 * 60 * 60 * 1000;

// Khong MemoryStore, khong cache session. Moi request doc du lieu tu Atlas.
// Doc session bang user Read; upsert/touch/delete bang user Write.
export class AtlasSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
  }

  expiresAt(data) {
    return data.cookie?.expires ? new Date(data.cookie.expires) : new Date(Date.now() + SESSION_TTL);
  }

  get(sid, callback) {
    this.database.getSession(sid)
      .then((document) => callback(null, document ? JSON.parse(document.data) : null))
      .catch(callback);
  }

  set(sid, data, callback = () => {}) {
    this.database.setSession(sid, JSON.stringify(data), this.expiresAt(data))
      .then(() => callback(null)).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.database.destroySession(sid).then(() => callback(null)).catch(callback);
  }

  touch(sid, data, callback = () => {}) {
    this.database.touchSession(sid, this.expiresAt(data)).then(() => callback(null)).catch(callback);
  }
}
