import { type Db, MongoClient } from "mongodb";

export interface MongoResources {
  client: MongoClient;
  db: Db;
}

export async function createMongoResources(
  uri: string,
  databaseName: string,
): Promise<MongoResources> {
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
  });

  try {
    await client.connect();

    const db = client.db(databaseName);

    await db.command({
      ping: 1,
    });

    return {
      client,
      db,
    };
  } catch {
    await client.close().catch(() => {});
    throw new Error("MongoDB connection failed");
  }
}
