import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type { Role, ShareAccess } from '../shared/roles.js';

export interface UserDoc {
  _id: ObjectId;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: string; // SHA-256 of the session token; the token itself is only ever in the user's cookie
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

export interface ProjectDoc {
  _id: ObjectId;
  name: string;
  ownerId: ObjectId;
  members: { userId: ObjectId; access: ShareAccess }[];
  data: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: ObjectId;
  // Set when the client sent a request id with the create; a repeat of that request returns this project.
  createRequestId?: string;
}

export interface VersionDoc {
  _id: ObjectId;
  projectId: ObjectId;
  name: string;
  data: Record<string, unknown>;
  createdAt: Date;
  createdBy: ObjectId;
  createdByName: string;
}

export interface LoginAttemptDoc { _id: string; count: number; expiresAt: Date }

// One client per process. Serverless functions reuse warm processes, so the connection is reused too.
let clientPromise: Promise<MongoClient> | null = null;

async function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set. Copy .env.example to .env and add your MongoDB Atlas connection string.');
  const client = await new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 }).connect();
  await ensureIndexes(client.db(dbName()));
  return client;
}

export const dbName = () => process.env.MONGODB_DB || 'neoproject';

export async function getDb(): Promise<Db> {
  if (!clientPromise) {
    const attempt = connect();
    clientPromise = attempt;
    // A failed connection is not cached, so the next request tries again.
    attempt.catch(() => { if (clientPromise === attempt) clientPromise = null; });
  }
  return (await clientPromise).db(dbName());
}

export async function closeDb() {
  if (!clientPromise) return;
  const c = await clientPromise.catch(() => null);
  clientPromise = null;
  await c?.close();
}

async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('sessions').createIndex({ userId: 1 }),
    db.collection('projects').createIndex({ ownerId: 1 }),
    db.collection('projects').createIndex({ 'members.userId': 1 }),
    db.collection('projects').createIndex({ ownerId: 1, createRequestId: 1 }, { unique: true, partialFilterExpression: { createRequestId: { $type: 'string' } } }),
    db.collection('versions').createIndex({ projectId: 1, createdAt: -1 }),
    db.collection('login_attempts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
}

export const col = {
  users: async (): Promise<Collection<UserDoc>> => (await getDb()).collection<UserDoc>('users'),
  sessions: async (): Promise<Collection<SessionDoc>> => (await getDb()).collection<SessionDoc>('sessions'),
  projects: async (): Promise<Collection<ProjectDoc>> => (await getDb()).collection<ProjectDoc>('projects'),
  versions: async (): Promise<Collection<VersionDoc>> => (await getDb()).collection<VersionDoc>('versions'),
  loginAttempts: async (): Promise<Collection<LoginAttemptDoc>> => (await getDb()).collection<LoginAttemptDoc>('login_attempts')
};
