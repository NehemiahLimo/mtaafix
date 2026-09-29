import { createMemoryStore } from "../repositories/memoryStore.js";

let defaultStore;

export async function getStore() {
  if (!defaultStore) {
    if (process.env.STORE_TYPE === "dynamodb") {
      const { createDynamoStore } = await import("../repositories/dynamoStore.js");
      defaultStore = createDynamoStore();
    } else {
      defaultStore = createMemoryStore();
    }
  }
  return defaultStore;
}

export function resetStore(seed) {
  defaultStore = createMemoryStore(seed);
  return defaultStore;
}
