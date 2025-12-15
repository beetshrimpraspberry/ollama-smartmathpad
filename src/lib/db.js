import Dexie from 'dexie';

// Initialize Dexie database
const db = new Dexie('NeoCalcDB');

// Define schema
db.version(1).stores({
    files: '++id, title, updatedAt', // id, title, content, aiLogic, updatedAt
    settings: 'key', // key, value
    logs: '++id, timestamp' // id, type, message, data, timestamp
});

// File operations
export const createFile = async (title = 'Untitled.calc', content = '') => {
    const id = await db.files.add({
        title,
        content,
        aiLogic: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
    return id;
};

export const saveFile = async (id, content, aiLogic = null) => {
    const updates = {
        content,
        updatedAt: Date.now()
    };
    if (aiLogic !== null) {
        updates.aiLogic = aiLogic;
    }
    await db.files.update(id, updates);
};

export const renameFile = async (id, title) => {
    await db.files.update(id, { title, updatedAt: Date.now() });
};

export const deleteFile = async (id) => {
    await db.files.delete(id);
};

export const getFile = async (id) => {
    return await db.files.get(id);
};

export const getAllFiles = async () => {
    return await db.files.orderBy('updatedAt').reverse().toArray();
};

// Settings operations
export const getSetting = async (key, defaultValue = null) => {
    const setting = await db.settings.get(key);
    return setting?.value ?? defaultValue;
};

export const setSetting = async (key, value) => {
    await db.settings.put({ key, value });
};

// Logging operations
const MAX_LOGS = 100;

export const addLog = async (type, message, data = null) => {
    await db.logs.add({
        type,
        message,
        data,
        timestamp: Date.now()
    });

    // Trim old logs
    const count = await db.logs.count();
    if (count > MAX_LOGS) {
        const oldest = await db.logs.orderBy('id').first();
        if (oldest) await db.logs.delete(oldest.id);
    }
};

export const getLogs = async (limit = 50) => {
    return await db.logs.orderBy('timestamp').reverse().limit(limit).toArray();
};

export const clearLogs = async () => {
    await db.logs.clear();
};

export default db;
