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
const PARCELS_BACKUP_FILE = path.resolve(DATA_DIR, 'parcels-backup.json');

interface PendingWriteRecord {
  id: string;
  collection: string;
  docId: string;
  action: string;
  data?: Record<string, unknown>;
  queuedAt: string;
  queuedByMemberId?: string;
  queuedByName?: string;
  queuedByRole?: string;
}

interface StagingFilePayload {
  updatedAt: string;
  scheduledTime: string;
  pendingWrites: PendingWriteRecord[];
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

interface ParcelsBackupFilePayload {
  updatedAt: string;
  count: number;
  source?: string;
  parcels: Array<Record<string, unknown>>;
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

function mergePendingWritesRecords(
  existing: PendingWriteRecord[],
  incoming: PendingWriteRecord[]
): PendingWriteRecord[] {
  const map = new Map<string, PendingWriteRecord>();
  for (const item of existing) {
    if (!item?.collection || !item?.docId) continue;
    map.set(`${item.collection}:${item.docId}`, item);
  }
  for (const item of incoming) {
    if (!item?.collection || !item?.docId) continue;
    const key = `${item.collection}:${item.docId}`;
    const prev = map.get(key);
    if (!prev || String(item.queuedAt || '') >= String(prev.queuedAt || '')) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function mergeParcelArrays(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>,
  pendingWrites: PendingWriteRecord[]
): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const p of existing) {
    const id = String(p.id || p.trackingNumber || '').trim();
    if (id) map.set(id, p);
  }
  for (const p of incoming) {
    const id = String(p.id || p.trackingNumber || '').trim();
    if (!id) continue;
    const prev = map.get(id);
    if (!prev || String(p.updatedAt || p.createdAt || '') >= String(prev.updatedAt || prev.createdAt || '')) {
      map.set(id, p);
    }
  }
  for (const item of pendingWrites) {
    if (item.collection === 'parcels') {
      if (item.action === 'delete') {
        map.delete(item.docId);
      } else if (item.data) {
        const id = String(item.data.id || item.data.trackingNumber || item.docId).trim();
        if (id) map.set(id, item.data);
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime()
  );
}

function buildMultiUserParcelSummary(
  parcels: Array<Record<string, unknown>>,
  pendingWrites: PendingWriteRecord[]
) {
  const now = new Date();
  const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  const userMap = new Map<
    string,
    {
      userKey: string;
      userName: string;
      userRole: string;
      totalParcels: number;
      todayParcels: number;
      pendingUploadCount: number;
    }
  >();

  const ensureUser = (key: string, name: string, role: string) => {
    const existing = userMap.get(key);
    if (existing) return existing;
    const entry = {
      userKey: key,
      userName: name,
      userRole: role,
      totalParcels: 0,
      todayParcels: 0,
      pendingUploadCount: 0,
    };
    userMap.set(key, entry);
    return entry;
  };

  let todayParcelsInBackup = 0;
  for (const p of parcels) {
    const recDate = String(p.receivedDate || '').slice(0, 10);
    const isToday = recDate === todayYMD;
    if (isToday) todayParcelsInBackup++;

    const uKey = String(p.recordedByMemberId || p.recordedByName || p.ownerId || 'workspace_shared');
    const uName = String(
      p.recordedByName ||
        (uKey === 'tasawan_app01_pcccr_ac_th' || uKey === 'workspace_shared'
          ? 'บัญชีหลัก / ซิงก์จากระบบกลาง'
          : uKey)
    );
    const uRole = String(p.recordedByRole || 'ผู้ใช้งานระบบ');
    const stat = ensureUser(uKey, uName, uRole);
    stat.totalParcels += 1;
    if (isToday) stat.todayParcels += 1;
  }

  let pendingParcelsToUpload = 0;
  for (const item of pendingWrites) {
    if (item.collection === 'parcels' && item.action !== 'delete') {
      pendingParcelsToUpload += 1;
      const pData = item.data || {};
      const uKey = String(
        item.queuedByMemberId ||
          pData.recordedByMemberId ||
          item.queuedByName ||
          pData.recordedByName ||
          pData.ownerId ||
          'workspace_shared'
      );
      const uName = String(
        item.queuedByName ||
          pData.recordedByName ||
          (uKey === 'tasawan_app01_pcccr_ac_th' || uKey === 'workspace_shared'
            ? 'บัญชีหลัก / ซิงก์จากระบบกลาง'
            : uKey)
      );
      const uRole = String(item.queuedByRole || pData.recordedByRole || 'ผู้ใช้งานระบบ');
      const stat = ensureUser(uKey, uName, uRole);
      stat.pendingUploadCount += 1;
    }
  }

  const byUser = Array.from(userMap.values()).sort(
    (a, b) => b.totalParcels - a.totalParcels || b.pendingUploadCount - a.pendingUploadCount
  );

  return {
    totalParcelsInBackup: parcels.length,
    todayParcelsInBackup,
    pendingParcelsToUpload,
    totalPendingItemsToUpload: pendingWrites.length,
    byUser,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // 1. Load local staging file + local search cache + permanent student & parcel backup DBs
  app.get('/api/local-store/load', (_req, res) => {
    const stagingData = readJsonSafe<StagingFilePayload>(STAGING_FILE);
    const cacheData = readJsonSafe<CacheFilePayload>(CACHE_FILE);
    const studentsBackupData = readJsonSafe<StudentsBackupFilePayload>(STUDENTS_BACKUP_FILE);
    const parcelsBackupData = readJsonSafe<ParcelsBackupFilePayload>(PARCELS_BACKUP_FILE);
    const pendingWrites = Array.isArray(stagingData?.pendingWrites) ? stagingData.pendingWrites : [];

    const consolidatedParcels = mergeParcelArrays(
      Array.isArray(parcelsBackupData?.parcels) ? parcelsBackupData.parcels : [],
      Array.isArray(cacheData?.parcels) ? cacheData.parcels : [],
      pendingWrites
    );

    const resolvedCache = cacheData
      ? {
          ...cacheData,
          parcels: consolidatedParcels,
        }
      : consolidatedParcels.length > 0
      ? { parcels: consolidatedParcels }
      : null;

    res.json({
      ok: true,
      hasServerStore: true,
      stagingFileExists: fs.existsSync(STAGING_FILE),
      stagingFilePath: 'data/pending-upload-backup.json',
      cacheFileExists: fs.existsSync(CACHE_FILE),
      cacheFilePath: 'data/local-search-cache.json',
      studentsBackupFileExists: fs.existsSync(STUDENTS_BACKUP_FILE),
      studentsBackupFilePath: 'data/students-backup.json',
      parcelsBackupFileExists: fs.existsSync(PARCELS_BACKUP_FILE),
      parcelsBackupFilePath: 'data/parcels-backup.json',
      pendingWrites,
      cache: resolvedCache,
      studentsBackup: studentsBackupData,
      parcelsBackup: parcelsBackupData || {
        updatedAt: cacheData?.updatedAt || null,
        count: consolidatedParcels.length,
        source: 'consolidated_cache',
        parcels: consolidatedParcels,
      },
      parcelSummary: buildMultiUserParcelSummary(consolidatedParcels, pendingWrites),
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

  // 1D. Load & save dedicated persistent parcels backup database (across all users)
  app.get('/api/local-store/parcels-backup', (_req, res) => {
    const backup = readJsonSafe<ParcelsBackupFilePayload>(PARCELS_BACKUP_FILE);
    const cacheData = readJsonSafe<CacheFilePayload>(CACHE_FILE);
    const stagingData = readJsonSafe<StagingFilePayload>(STAGING_FILE);
    const pendingWrites = Array.isArray(stagingData?.pendingWrites) ? stagingData.pendingWrites : [];
    const parcels = mergeParcelArrays(
      Array.isArray(backup?.parcels) ? backup.parcels : [],
      Array.isArray(cacheData?.parcels) ? cacheData.parcels : [],
      pendingWrites
    );
    res.json({
      ok: true,
      hasServerStore: true,
      fileExists: fs.existsSync(PARCELS_BACKUP_FILE),
      filePath: 'data/parcels-backup.json',
      count: parcels.length,
      updatedAt: backup?.updatedAt || cacheData?.updatedAt || null,
      source: backup?.source || null,
      parcels,
      summary: buildMultiUserParcelSummary(parcels, pendingWrites),
    });
  });

  app.post('/api/local-store/parcels-backup', (req, res) => {
    try {
      const body = req.body as {
        parcels?: Array<Record<string, unknown>>;
        source?: string;
        replaceAll?: boolean;
      };
      const incomingParcels = Array.isArray(body?.parcels) ? body.parcels : [];
      const existingBackup = readJsonSafe<ParcelsBackupFilePayload>(PARCELS_BACKUP_FILE);
      const stagingData = readJsonSafe<StagingFilePayload>(STAGING_FILE);
      const pendingWrites = Array.isArray(stagingData?.pendingWrites) ? stagingData.pendingWrites : [];

      const finalParcels = body?.replaceAll
        ? incomingParcels
        : mergeParcelArrays(
            Array.isArray(existingBackup?.parcels) ? existingBackup.parcels : [],
            incomingParcels,
            pendingWrites
          );

      const nowIso = new Date().toISOString();
      const payload: ParcelsBackupFilePayload = {
        updatedAt: nowIso,
        count: finalParcels.length,
        source: body?.source || 'multi_user_parcel_backup',
        parcels: finalParcels,
      };
      writeJsonSafe(PARCELS_BACKUP_FILE, payload);

      const existingCache = readJsonSafe<CacheFilePayload>(CACHE_FILE) || {};
      writeJsonSafe(CACHE_FILE, {
        ...existingCache,
        parcels: finalParcels,
        updatedAt: nowIso,
      });

      res.json({
        ok: true,
        fileExists: fs.existsSync(PARCELS_BACKUP_FILE),
        filePath: 'data/parcels-backup.json',
        count: finalParcels.length,
        updatedAt: nowIso,
        source: payload.source,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to save parcels backup file',
      });
    }
  });

  // 1E. Summary across ALL users in backup database & ready-to-upload queue
  app.get('/api/local-store/parcels-summary', (_req, res) => {
    const stagingData = readJsonSafe<StagingFilePayload>(STAGING_FILE);
    const cacheData = readJsonSafe<CacheFilePayload>(CACHE_FILE);
    const parcelsBackup = readJsonSafe<ParcelsBackupFilePayload>(PARCELS_BACKUP_FILE);
    const pendingWrites = Array.isArray(stagingData?.pendingWrites) ? stagingData.pendingWrites : [];
    const parcels = mergeParcelArrays(
      Array.isArray(parcelsBackup?.parcels) ? parcelsBackup.parcels : [],
      Array.isArray(cacheData?.parcels) ? cacheData.parcels : [],
      pendingWrites
    );

    res.json({
      ok: true,
      hasServerStore: true,
      filePath: 'data/parcels-backup.json',
      stagingFilePath: 'data/pending-upload-backup.json',
      ...buildMultiUserParcelSummary(parcels, pendingWrites),
    });
  });

  // 2. Save staged items to data/pending-upload-backup.json (safely merging across all users)
  app.post('/api/local-store/stage', (req, res) => {
    try {
      const body = req.body as {
        pendingWrites?: PendingWriteRecord[];
        appendItems?: PendingWriteRecord[];
        replacePending?: boolean;
        replaceCacheParcels?: boolean;
        cache?: CacheFilePayload;
      };
      const incomingPending = Array.isArray(body?.appendItems)
        ? body.appendItems
        : Array.isArray(body?.pendingWrites)
        ? body.pendingWrites
        : [];
      const existingStaging = readJsonSafe<StagingFilePayload>(STAGING_FILE);
      const existingPending = Array.isArray(existingStaging?.pendingWrites)
        ? existingStaging.pendingWrites
        : [];

      const mergedPending = body?.replacePending
        ? Array.isArray(body?.pendingWrites)
          ? body.pendingWrites
          : incomingPending
        : mergePendingWritesRecords(existingPending, incomingPending);

      const nowIso = new Date().toISOString();

      if (mergedPending.length > 0) {
        const stagingPayload: StagingFilePayload = {
          updatedAt: nowIso,
          scheduledTime: '00:00',
          pendingWrites: mergedPending,
        };
        writeJsonSafe(STAGING_FILE, stagingPayload);
      } else {
        deleteFileIfExists(STAGING_FILE);
      }

      const existingCache = readJsonSafe<CacheFilePayload>(CACHE_FILE) || {};
      const existingParcelsBackup = readJsonSafe<ParcelsBackupFilePayload>(PARCELS_BACKUP_FILE);

      let mergedParcels = Array.isArray(existingParcelsBackup?.parcels)
        ? existingParcelsBackup.parcels
        : Array.isArray(existingCache.parcels)
        ? existingCache.parcels
        : [];

      if (body?.cache && typeof body.cache === 'object') {
        if (Array.isArray(body.cache.parcels)) {
          mergedParcels = body.replaceCacheParcels
            ? body.cache.parcels
            : mergeParcelArrays(mergedParcels, body.cache.parcels, mergedPending);
        } else {
          mergedParcels = mergeParcelArrays(mergedParcels, [], mergedPending);
        }

        writeJsonSafe(CACHE_FILE, {
          ...existingCache,
          ...body.cache,
          parcels: mergedParcels,
          updatedAt: nowIso,
        });

        writeJsonSafe(PARCELS_BACKUP_FILE, {
          updatedAt: nowIso,
          count: mergedParcels.length,
          source: 'auto_stage_parcel_backup',
          parcels: mergedParcels,
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
        stagedCount: mergedPending.length,
        stagingFilePath: 'data/pending-upload-backup.json',
        pendingWrites: mergedPending,
        totalParcelsCount: mergedParcels.length,
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
      if (Array.isArray(body.parcels)) {
        writeJsonSafe(PARCELS_BACKUP_FILE, {
          updatedAt: nowIso,
          count: body.parcels.length,
          source: 'auto_cache_parcel_backup',
          parcels: body.parcels,
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

  // 4. Delete uploaded items from staged backup file after successful upload to Firebase
  app.post('/api/local-store/clear-staging', (req, res) => {
    try {
      const body = (req.body || {}) as {
        lastAutoUploadDate?: string | null;
        lastUploadedAt?: string | null;
        uploadedKeys?: string[];
      };

      let deleted = false;
      let remainingPending: PendingWriteRecord[] = [];

      if (Array.isArray(body.uploadedKeys) && body.uploadedKeys.length > 0) {
        const uploadedSet = new Set(body.uploadedKeys);
        const existingStaging = readJsonSafe<StagingFilePayload>(STAGING_FILE);
        const currentPending = Array.isArray(existingStaging?.pendingWrites)
          ? existingStaging.pendingWrites
          : [];
        remainingPending = currentPending.filter(
          (item) => !uploadedSet.has(`${item.collection}:${item.docId}`)
        );
        if (remainingPending.length > 0) {
          writeJsonSafe(STAGING_FILE, {
            updatedAt: new Date().toISOString(),
            scheduledTime: '00:00',
            pendingWrites: remainingPending,
          });
        } else {
          deleted = deleteFileIfExists(STAGING_FILE);
        }
      } else {
        deleted = deleteFileIfExists(STAGING_FILE);
      }

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
        remainingPending,
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

    const parcelsBackup = readJsonSafe<ParcelsBackupFilePayload>(PARCELS_BACKUP_FILE);
    const allParcels = mergeParcelArrays(
      Array.isArray(parcelsBackup?.parcels) ? parcelsBackup.parcels : [],
      Array.isArray(cacheData?.parcels) ? cacheData.parcels : [],
      Array.isArray(stagingData?.pendingWrites) ? stagingData.pendingWrites : []
    );

    const parcelResults = allParcels.filter((p) => {
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
