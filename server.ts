import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DATA_DIR = path.resolve(__dirname, 'data');
const STAGING_FILE = path.resolve(DATA_DIR, 'pending-upload-backup.json');
const CACHE_FILE = path.resolve(DATA_DIR, 'local-search-cache.json');
const STUDENTS_BACKUP_FILE = path.resolve(DATA_DIR, 'students-backup.json');

interface StagingFilePayload {
  updatedAt: string;
  scheduledTime: string;
  pendingWrites: Array<{
    id: string;
    collection: string;
    docId: string;
    action: string;
    data?: Record<string, unknown>;
    queuedAt: string;
  }>;
}

interface CacheFilePayload {
  students?: Array<Record<string, unknown>>;
  parcels?: Array<Record<string, unknown>>;
  members?: Array<Record<string, unknown>>;
  rolePermissions?: Array<Record<string, unknown>>;
  rateLimitConfig?: Record<string, unknown> | null;
  lastSyncedAt?: string | null;
  lastAutoUploadDate?: string | null;
  lastUploadedAt?: string | null;
  updatedAt?: string;
}

interface StudentsBackupFilePayload {
  updatedAt: string;
  count: number;
  source?: string;
  students: Array<Record<string, unknown>>;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`Failed to read ${filePath}:`, err);
    return null;
  }
}

function writeJsonSafe(filePath: string, data: unknown): void {
  ensureDataDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function deleteFileIfExists(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`Failed to delete ${filePath}:`, err);
    return false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // 1. Load local staging file + local search cache + permanent student backup DB
  app.get('/api/local-store/load', (_req, res) => {
    const stagingData = readJsonSafe<StagingFilePayload>(STAGING_FILE);
    const cacheData = readJsonSafe<CacheFilePayload>(CACHE_FILE);
    const studentsBackupData = readJsonSafe<StudentsBackupFilePayload>(STUDENTS_BACKUP_FILE);
    const pendingWrites = Array.isArray(stagingData?.pendingWrites) ? stagingData.pendingWrites : [];

    res.json({
      ok: true,
      hasServerStore: true,
      stagingFileExists: fs.existsSync(STAGING_FILE),
      stagingFilePath: 'data/pending-upload-backup.json',
      cacheFileExists: fs.existsSync(CACHE_FILE),
      cacheFilePath: 'data/local-search-cache.json',
      studentsBackupFileExists: fs.existsSync(STUDENTS_BACKUP_FILE),
      studentsBackupFilePath: 'data/students-backup.json',
      pendingWrites,
      cache: cacheData,
      studentsBackup: studentsBackupData,
    });
  });

  // 1B. Load dedicated persistent students backup database
  app.get('/api/local-store/students-backup', (_req, res) => {
    const backup = readJsonSafe<StudentsBackupFilePayload>(STUDENTS_BACKUP_FILE);
    const students = Array.isArray(backup?.students) ? backup.students : [];
    res.json({
      ok: true,
      hasServerStore: true,
      fileExists: fs.existsSync(STUDENTS_BACKUP_FILE),
      filePath: 'data/students-backup.json',
      count: students.length,
      updatedAt: backup?.updatedAt || null,
      source: backup?.source || null,
      students,
    });
  });

  // 1C. Save all students into permanent backup database (never deleted on midnight sync)
  app.post('/api/local-store/students-backup', (req, res) => {
    try {
      const body = req.body as {
        students?: Array<Record<string, unknown>>;
        source?: string;
      };
      const students = Array.isArray(body?.students) ? body.students : [];
      const nowIso = new Date().toISOString();
      const payload: StudentsBackupFilePayload = {
        updatedAt: nowIso,
        count: students.length,
        source: body?.source || 'manual_or_sync_backup',
        students,
      };
      writeJsonSafe(STUDENTS_BACKUP_FILE, payload);

      const existingCache = readJsonSafe<CacheFilePayload>(CACHE_FILE) || {};
      writeJsonSafe(CACHE_FILE, {
        ...existingCache,
        students,
        updatedAt: nowIso,
      });

      res.json({
        ok: true,
        fileExists: fs.existsSync(STUDENTS_BACKUP_FILE),
        filePath: 'data/students-backup.json',
        count: students.length,
        updatedAt: nowIso,
        source: payload.source,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to save students backup file',
      });
    }
  });

  // 2. Save staged items to data/pending-upload-backup.json (and optionally update search cache)
  app.post('/api/local-store/stage', (req, res) => {
    try {
      const body = req.body as {
        pendingWrites?: StagingFilePayload['pendingWrites'];
        cache?: CacheFilePayload;
      };
      const pendingWrites = Array.isArray(body?.pendingWrites) ? body.pendingWrites : [];

      if (pendingWrites.length > 0) {
        const stagingPayload: StagingFilePayload = {
          updatedAt: new Date().toISOString(),
          scheduledTime: '00:00',
          pendingWrites,
        };
        writeJsonSafe(STAGING_FILE, stagingPayload);
      } else {
        deleteFileIfExists(STAGING_FILE);
      }

      if (body?.cache && typeof body.cache === 'object') {
        const existingCache = readJsonSafe<CacheFilePayload>(CACHE_FILE) || {};
        const nowIso = new Date().toISOString();
        writeJsonSafe(CACHE_FILE, {
          ...existingCache,
          ...body.cache,
          updatedAt: nowIso,
        });
        if (Array.isArray(body.cache.students)) {
          writeJsonSafe(STUDENTS_BACKUP_FILE, {
            updatedAt: nowIso,
            count: body.cache.students.length,
            source: 'auto_stage_backup',
            students: body.cache.students,
          });
        }
      }

      res.json({
        ok: true,
        stagingFileExists: fs.existsSync(STAGING_FILE),
        stagedCount: pendingWrites.length,
        stagingFilePath: 'data/pending-upload-backup.json',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to save local staging file',
      });
    }
  });

  // 3. Save local search cache mirror to data/local-search-cache.json
  app.post('/api/local-store/cache', (req, res) => {
    try {
      const body = req.body as CacheFilePayload;
      const existingCache = readJsonSafe<CacheFilePayload>(CACHE_FILE) || {};
      const nowIso = new Date().toISOString();
      writeJsonSafe(CACHE_FILE, {
        ...existingCache,
        ...body,
        updatedAt: nowIso,
      });
      if (Array.isArray(body.students) && body.students.length > 0) {
        writeJsonSafe(STUDENTS_BACKUP_FILE, {
          updatedAt: nowIso,
          count: body.students.length,
          source: 'auto_cache_backup',
          students: body.students,
        });
      }
      res.json({
        ok: true,
        cacheFileExists: fs.existsSync(CACHE_FILE),
        cacheFilePath: 'data/local-search-cache.json',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to save local cache file',
      });
    }
  });

  // 4. Delete staged backup file after successful upload to Firebase
  app.post('/api/local-store/clear-staging', (req, res) => {
    try {
      const body = (req.body || {}) as {
        lastAutoUploadDate?: string | null;
        lastUploadedAt?: string | null;
      };
      const deleted = deleteFileIfExists(STAGING_FILE);

      const existingCache = readJsonSafe<CacheFilePayload>(CACHE_FILE) || {};
      writeJsonSafe(CACHE_FILE, {
        ...existingCache,
        lastAutoUploadDate:
          body.lastAutoUploadDate !== undefined
            ? body.lastAutoUploadDate
            : existingCache.lastAutoUploadDate || null,
        lastUploadedAt: body.lastUploadedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      res.json({
        ok: true,
        deletedStagingFile: deleted,
        stagingFileExists: fs.existsSync(STAGING_FILE),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to clear local staging file',
      });
    }
  });

  // 5. Search local system backup files first (staging + cache) before querying Firebase
  app.get('/api/local-store/search', (req, res) => {
    const keyword = String(req.query.q || '').trim().toLowerCase();
    const type = String(req.query.type || 'parcels').trim().toLowerCase();

    const stagingData = readJsonSafe<StagingFilePayload>(STAGING_FILE);
    const cacheData = readJsonSafe<CacheFilePayload>(CACHE_FILE);

    if (type === 'students') {
      const studentsBackup = readJsonSafe<StudentsBackupFilePayload>(STUDENTS_BACKUP_FILE);
      const map = new Map<string, Record<string, unknown>>();
      for (const s of studentsBackup?.students || []) {
        const code = String(s.studentCode || '').trim();
        if (code) map.set(code, s);
      }
      for (const s of cacheData?.students || []) {
        const code = String(s.studentCode || '').trim();
        if (code) map.set(code, s);
      }
      for (const item of stagingData?.pendingWrites || []) {
        if (item.collection === 'students') {
          if (item.action === 'delete') {
            map.delete(item.docId);
          } else if (item.data) {
            map.set(item.docId, item.data);
          }
        }
      }
      const results = Array.from(map.values()).filter((s) => {
        if (!keyword) return true;
        return (
          String(s.studentCode || '').toLowerCase().includes(keyword) ||
          String(s.firstName || '').toLowerCase().includes(keyword) ||
          String(s.lastName || '').toLowerCase().includes(keyword) ||
          String(s.nickname || '').toLowerCase().includes(keyword) ||
          String(s.dormitory || '').toLowerCase().includes(keyword)
        );
      });
      res.json({ ok: true, source: 'local-backup-file', results });
      return;
    }

    const parcelMap = new Map<string, Record<string, unknown>>();
    for (const p of cacheData?.parcels || []) {
      const id = String(p.id || p.trackingNumber || '').trim();
      if (id) parcelMap.set(id, p);
    }
    for (const item of stagingData?.pendingWrites || []) {
      if (item.collection === 'parcels') {
        if (item.action === 'delete') {
          parcelMap.delete(item.docId);
        } else if (item.data) {
          parcelMap.set(item.docId, item.data);
        }
      }
    }

    const parcelResults = Array.from(parcelMap.values()).filter((p) => {
      if (!keyword) return true;
      return (
        String(p.trackingNumber || '').toLowerCase().includes(keyword) ||
        String(p.studentCode || '').toLowerCase().includes(keyword) ||
        String(p.studentFullName || '').toLowerCase().includes(keyword) ||
        String(p.nickname || '').toLowerCase().includes(keyword) ||
        String(p.dormitory || '').toLowerCase().includes(keyword)
      );
    });

    res.json({ ok: true, source: 'local-backup-file', results: parcelResults });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
