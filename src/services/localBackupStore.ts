import {
  Student,
  Parcel,
  Member,
  RolePermission,
  PendingWriteItem,
  ParcelRateLimitConfig,
} from '../types/parcel';

export const LOCAL_STAGING_STORAGE_KEY = 'spms_local_staging_v5';
export const LOCAL_CACHE_STORAGE_KEY = 'spms_local_backup_cache_v5';
export const LOCAL_AUTO_UPLOAD_META_KEY = 'spms_auto_upload_meta_v5';
export const LOCAL_STUDENTS_BACKUP_STORAGE_KEY = 'spms_students_backup_v5';

const IDB_NAME = 'spms_student_backup_db';
const IDB_VERSION = 1;
const IDB_STORE = 'student_backup_store';
const IDB_ALL_STUDENTS_KEY = 'all_students_backup';

export interface LocalCacheSnapshot {
  students: Student[];
  parcels: Parcel[];
  members: Member[];
  rolePermissions: RolePermission[];
  rateLimitConfig: ParcelRateLimitConfig | null;
  lastSyncedAt: string | null;
  lastAutoUploadDate: string | null;
  lastUploadedAt: string | null;
}

export interface StudentBackupRecord {
  students: Student[];
  count: number;
  updatedAt: string | null;
  source: string | null;
  filePath: string;
  serverFileActive: boolean;
  indexedDbActive: boolean;
}

export interface LoadedLocalBackupStore {
  serverFileActive: boolean;
  stagingFileExists: boolean;
  stagingFilePath: string;
  cacheFilePath: string;
  pendingWrites: PendingWriteItem[];
  cache: LocalCacheSnapshot | null;
  studentsBackup: StudentBackupRecord;
}

function readBrowserJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeBrowserJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota limits
  }
}

function openStudentBackupIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(IDB_STORE)) {
          database.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeStudentsToIdb(payload: {
  students: Student[];
  updatedAt: string;
  source: string;
}): Promise<boolean> {
  const database = await openStudentBackupIdb();
  if (!database) return false;
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(payload, IDB_ALL_STUDENTS_KEY);
      tx.oncomplete = () => {
        database.close();
        resolve(true);
      };
      tx.onerror = () => {
        database.close();
        resolve(false);
      };
    } catch {
      database.close();
      resolve(false);
    }
  });
}

async function readStudentsFromIdb(): Promise<{
  students: Student[];
  updatedAt: string | null;
  source: string | null;
  indexedDbActive: boolean;
}> {
  const database = await openStudentBackupIdb();
  if (!database) {
    return { students: [], updatedAt: null, source: null, indexedDbActive: false };
  }
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_ALL_STUDENTS_KEY);
      req.onsuccess = () => {
        const val = req.result as
          | { students?: Student[]; updatedAt?: string; source?: string }
          | undefined;
        database.close();
        resolve({
          students: Array.isArray(val?.students) ? val.students : [],
          updatedAt: val?.updatedAt || null,
          source: val?.source || null,
          indexedDbActive: true,
        });
      };
      req.onerror = () => {
        database.close();
        resolve({ students: [], updatedAt: null, source: null, indexedDbActive: false });
      };
    } catch {
      database.close();
      resolve({ students: [], updatedAt: null, source: null, indexedDbActive: false });
    }
  });
}

export function getLocalTodayYMD(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getNextMidnightScheduleInfo(now: Date = new Date()): {
  nextMidnightDate: Date;
  msUntilMidnight: number;
  isoString: string;
} {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return {
    nextMidnightDate: next,
    msUntilMidnight: Math.max(1000, next.getTime() - now.getTime()),
    isoString: next.toISOString(),
  };
}

/**
 * บันทึกรายชื่อนักเรียนทั้งหมดลงฐานข้อมูลสำรอง (ไฟล์ data/students-backup.json + IndexedDB + localStorage)
 * เพื่อใช้กรณีไม่สามารถเชื่อมต่อ Firestore ได้
 */
export async function saveAllStudentsToBackupDb(
  students: Student[],
  source: string = 'student_backup_db'
): Promise<StudentBackupRecord> {
  const nowIso = new Date().toISOString();
  const sorted = [...students].sort((a, b) => a.seqNo - b.seqNo);

  writeBrowserJson(LOCAL_STUDENTS_BACKUP_STORAGE_KEY, {
    updatedAt: nowIso,
    source,
    students: sorted,
  });

  const indexedDbActive = await writeStudentsToIdb({
    students: sorted,
    updatedAt: nowIso,
    source,
  });

  try {
    const res = await fetch('/api/local-store/students-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students: sorted, source }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        filePath?: string;
        updatedAt?: string;
        count?: number;
      };
      return {
        students: sorted,
        count: json.count ?? sorted.length,
        updatedAt: json.updatedAt || nowIso,
        source,
        filePath: json.filePath || 'data/students-backup.json',
        serverFileActive: true,
        indexedDbActive,
      };
    }
  } catch {
    // static / offline fallback
  }

  return {
    students: sorted,
    count: sorted.length,
    updatedAt: nowIso,
    source,
    filePath: indexedDbActive
      ? 'IndexedDB:spms_student_backup_db'
      : `localStorage:${LOCAL_STUDENTS_BACKUP_STORAGE_KEY}`,
    serverFileActive: false,
    indexedDbActive,
  };
}

/**
 * โหลดรายชื่อนักเรียนทั้งหมดจากฐานข้อมูลสำรอง (Server File -> IndexedDB -> localStorage)
 */
export async function loadAllStudentsFromBackupDb(): Promise<StudentBackupRecord> {
  const browserBackup = readBrowserJson<{
    students?: Student[];
    updatedAt?: string;
    source?: string;
  }>(LOCAL_STUDENTS_BACKUP_STORAGE_KEY);
  const idbBackup = await readStudentsFromIdb();

  try {
    const res = await fetch('/api/local-store/students-backup', { method: 'GET' });
    if (res.ok) {
      const json = (await res.json()) as {
        filePath?: string;
        updatedAt?: string | null;
        source?: string | null;
        students?: Student[];
      };
      const serverStudents = Array.isArray(json.students) ? json.students : [];
      const fallbackStudents =
        serverStudents.length > 0
          ? serverStudents
          : idbBackup.students.length > 0
          ? idbBackup.students
          : browserBackup?.students || [];

      if (serverStudents.length === 0 && fallbackStudents.length > 0) {
        // Restore server file automatically if browser IDB/localStorage has students
        await fetch('/api/local-store/students-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            students: fallbackStudents,
            source: 'auto_recovered_from_browser_backup',
          }),
        }).catch(() => undefined);
      }

      return {
        students: fallbackStudents,
        count: fallbackStudents.length,
        updatedAt: json.updatedAt || idbBackup.updatedAt || browserBackup?.updatedAt || null,
        source: json.source || idbBackup.source || browserBackup?.source || null,
        filePath: json.filePath || 'data/students-backup.json',
        serverFileActive: true,
        indexedDbActive: idbBackup.indexedDbActive,
      };
    }
  } catch {
    // static fallback
  }

  const bestStudents =
    idbBackup.students.length > 0 ? idbBackup.students : browserBackup?.students || [];
  return {
    students: bestStudents,
    count: bestStudents.length,
    updatedAt: idbBackup.updatedAt || browserBackup?.updatedAt || null,
    source: idbBackup.source || browserBackup?.source || null,
    filePath: idbBackup.indexedDbActive
      ? 'IndexedDB:spms_student_backup_db'
      : `localStorage:${LOCAL_STUDENTS_BACKUP_STORAGE_KEY}`,
    serverFileActive: false,
    indexedDbActive: idbBackup.indexedDbActive,
  };
}

/**
 * โหลดข้อมูลสำรองรออัพโหลดและแคชค้นหาในระบบ (ลำดับแรกจากไฟล์บนเซิร์ฟเวอร์ แล้วเสริมด้วย IndexedDB / localStorage)
 */
export async function loadLocalBackupStore(): Promise<LoadedLocalBackupStore> {
  const browserStaging = readBrowserJson<PendingWriteItem[]>(LOCAL_STAGING_STORAGE_KEY) || [];
  const browserCache = readBrowserJson<LocalCacheSnapshot>(LOCAL_CACHE_STORAGE_KEY);
  const browserMeta = readBrowserJson<{ lastAutoUploadDate?: string; lastUploadedAt?: string }>(
    LOCAL_AUTO_UPLOAD_META_KEY
  );
  const browserStudentsBackup = readBrowserJson<{
    students?: Student[];
    updatedAt?: string;
    source?: string;
  }>(LOCAL_STUDENTS_BACKUP_STORAGE_KEY);
  const idbBackup = await readStudentsFromIdb();

  try {
    const res = await fetch('/api/local-store/load', { method: 'GET' });
    if (res.ok) {
      const json = (await res.json()) as {
        hasServerStore?: boolean;
        stagingFileExists?: boolean;
        stagingFilePath?: string;
        cacheFilePath?: string;
        studentsBackupFilePath?: string;
        pendingWrites?: PendingWriteItem[];
        cache?: Partial<LocalCacheSnapshot> | null;
        studentsBackup?: {
          students?: Student[];
          updatedAt?: string;
          source?: string;
        } | null;
      };

      const serverPending = Array.isArray(json.pendingWrites) ? json.pendingWrites : [];
      const mergedPendingMap = new Map<string, PendingWriteItem>();
      for (const item of browserStaging) {
        mergedPendingMap.set(`${item.collection}:${item.docId}`, item);
      }
      for (const item of serverPending) {
        mergedPendingMap.set(`${item.collection}:${item.docId}`, item);
      }
      const mergedPending = Array.from(mergedPendingMap.values());
      if (mergedPending.length > 0) {
        writeBrowserJson(LOCAL_STAGING_STORAGE_KEY, mergedPending);
      }

      const serverBackupStudents = Array.isArray(json.studentsBackup?.students)
        ? json.studentsBackup.students
        : [];
      const resolvedBackupStudents =
        serverBackupStudents.length > 0
          ? serverBackupStudents
          : idbBackup.students.length > 0
          ? idbBackup.students
          : browserStudentsBackup?.students || [];

      const serverCache = json.cache;
      const resolvedCacheStudents =
        Array.isArray(serverCache?.students) && serverCache.students.length > 0
          ? serverCache.students
          : browserCache?.students && browserCache.students.length > 0
          ? browserCache.students
          : resolvedBackupStudents;

      const mergedCache: LocalCacheSnapshot | null =
        serverCache || browserCache || resolvedBackupStudents.length > 0
          ? {
              students: resolvedCacheStudents,
              parcels:
                Array.isArray(serverCache?.parcels) && serverCache.parcels.length > 0
                  ? serverCache.parcels
                  : browserCache?.parcels || [],
              members:
                Array.isArray(serverCache?.members) && serverCache.members.length > 0
                  ? serverCache.members
                  : browserCache?.members || [],
              rolePermissions:
                Array.isArray(serverCache?.rolePermissions) && serverCache.rolePermissions.length > 0
                  ? serverCache.rolePermissions
                  : browserCache?.rolePermissions || [],
              rateLimitConfig: serverCache?.rateLimitConfig ?? browserCache?.rateLimitConfig ?? null,
              lastSyncedAt: serverCache?.lastSyncedAt || browserCache?.lastSyncedAt || null,
              lastAutoUploadDate:
                serverCache?.lastAutoUploadDate ||
                browserCache?.lastAutoUploadDate ||
                browserMeta?.lastAutoUploadDate ||
                null,
              lastUploadedAt:
                serverCache?.lastUploadedAt ||
                browserCache?.lastUploadedAt ||
                browserMeta?.lastUploadedAt ||
                null,
            }
          : null;

      if (mergedCache) {
        writeBrowserJson(LOCAL_CACHE_STORAGE_KEY, mergedCache);
      }

      const finalBackupStudents =
        resolvedBackupStudents.length > 0 ? resolvedBackupStudents : resolvedCacheStudents;

      return {
        serverFileActive: Boolean(json.hasServerStore),
        stagingFileExists: Boolean(json.stagingFileExists),
        stagingFilePath: json.stagingFilePath || 'data/pending-upload-backup.json',
        cacheFilePath: json.cacheFilePath || 'data/local-search-cache.json',
        pendingWrites: mergedPending,
        cache: mergedCache,
        studentsBackup: {
          students: finalBackupStudents,
          count: finalBackupStudents.length,
          updatedAt:
            json.studentsBackup?.updatedAt ||
            idbBackup.updatedAt ||
            browserStudentsBackup?.updatedAt ||
            null,
          source:
            json.studentsBackup?.source ||
            idbBackup.source ||
            browserStudentsBackup?.source ||
            null,
          filePath: json.studentsBackupFilePath || 'data/students-backup.json',
          serverFileActive: Boolean(json.hasServerStore),
          indexedDbActive: idbBackup.indexedDbActive,
        },
      };
    }
  } catch {
    // Fallback to browser IndexedDB / localStorage when running purely statically
  }

  const bestStudentsBackup =
    idbBackup.students.length > 0
      ? idbBackup.students
      : browserStudentsBackup?.students && browserStudentsBackup.students.length > 0
      ? browserStudentsBackup.students
      : browserCache?.students || [];

  return {
    serverFileActive: false,
    stagingFileExists: browserStaging.length > 0,
    stagingFilePath: 'localStorage:spms_local_staging_v5',
    cacheFilePath: 'localStorage:spms_local_backup_cache_v5',
    pendingWrites: browserStaging,
    cache:
      browserCache || bestStudentsBackup.length > 0
        ? {
            students:
              browserCache?.students && browserCache.students.length > 0
                ? browserCache.students
                : bestStudentsBackup,
            parcels: browserCache?.parcels || [],
            members: browserCache?.members || [],
            rolePermissions: browserCache?.rolePermissions || [],
            rateLimitConfig: browserCache?.rateLimitConfig ?? null,
            lastSyncedAt: browserCache?.lastSyncedAt || null,
            lastAutoUploadDate:
              browserCache?.lastAutoUploadDate || browserMeta?.lastAutoUploadDate || null,
            lastUploadedAt: browserCache?.lastUploadedAt || browserMeta?.lastUploadedAt || null,
          }
        : null,
    studentsBackup: {
      students: bestStudentsBackup,
      count: bestStudentsBackup.length,
      updatedAt: idbBackup.updatedAt || browserStudentsBackup?.updatedAt || null,
      source: idbBackup.source || browserStudentsBackup?.source || null,
      filePath: idbBackup.indexedDbActive
        ? 'IndexedDB:spms_student_backup_db'
        : `localStorage:${LOCAL_STUDENTS_BACKUP_STORAGE_KEY}`,
      serverFileActive: false,
      indexedDbActive: idbBackup.indexedDbActive,
    },
  };
}

/**
 * บันทึกข้อมูลที่รออัปโหลดลงไฟล์สำรองในระบบ (data/pending-upload-backup.json + localStorage)
 */
export async function saveStagedWritesToLocalFile(
  pendingWrites: PendingWriteItem[],
  cache?: Partial<LocalCacheSnapshot>
): Promise<{ serverFileActive: boolean; stagingFileExists: boolean }> {
  if (pendingWrites.length > 0) {
    writeBrowserJson(LOCAL_STAGING_STORAGE_KEY, pendingWrites);
  } else {
    try {
      localStorage.removeItem(LOCAL_STAGING_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  if (cache) {
    const prev = readBrowserJson<Partial<LocalCacheSnapshot>>(LOCAL_CACHE_STORAGE_KEY) || {};
    writeBrowserJson(LOCAL_CACHE_STORAGE_KEY, { ...prev, ...cache });
    if (Array.isArray(cache.students)) {
      const nowIso = new Date().toISOString();
      writeBrowserJson(LOCAL_STUDENTS_BACKUP_STORAGE_KEY, {
        updatedAt: nowIso,
        source: 'auto_stage_backup',
        students: cache.students,
      });
      void writeStudentsToIdb({
        students: cache.students,
        updatedAt: nowIso,
        source: 'auto_stage_backup',
      });
    }
  }

  try {
    const res = await fetch('/api/local-store/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingWrites, cache }),
    });
    if (res.ok) {
      const json = (await res.json()) as { stagingFileExists?: boolean };
      return {
        serverFileActive: true,
        stagingFileExists: Boolean(json.stagingFileExists),
      };
    }
  } catch {
    // static fallback
  }

  return {
    serverFileActive: false,
    stagingFileExists: pendingWrites.length > 0,
  };
}

/**
 * บันทึกแคชค้นหาในระบบ (data/local-search-cache.json + localStorage + IndexedDB นักเรียน)
 */
export async function saveLocalSearchCache(cache: Partial<LocalCacheSnapshot>): Promise<void> {
  const prev = readBrowserJson<Partial<LocalCacheSnapshot>>(LOCAL_CACHE_STORAGE_KEY) || {};
  writeBrowserJson(LOCAL_CACHE_STORAGE_KEY, { ...prev, ...cache });

  if (Array.isArray(cache.students) && cache.students.length > 0) {
    const nowIso = new Date().toISOString();
    writeBrowserJson(LOCAL_STUDENTS_BACKUP_STORAGE_KEY, {
      updatedAt: nowIso,
      source: 'auto_cache_backup',
      students: cache.students,
    });
    await writeStudentsToIdb({
      students: cache.students,
      updatedAt: nowIso,
      source: 'auto_cache_backup',
    });
  }

  try {
    await fetch('/api/local-store/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cache),
    });
  } catch {
    // static fallback
  }
}

/**
 * ลบไฟล์ข้อมูลสำรองรออัพโหลดออกจากระบบหลังอัปโหลดขึ้น Firebase สำเร็จแล้ว
 * (ไม่ลบไฟล์ฐานข้อมูลสำรองรายชื่อนักเรียน data/students-backup.json)
 */
export async function clearStagedBackupAfterUpload(meta: {
  lastAutoUploadDate: string | null;
  lastUploadedAt: string;
}): Promise<{ serverFileActive: boolean; deletedStagingFile: boolean }> {
  try {
    localStorage.removeItem(LOCAL_STAGING_STORAGE_KEY);
    writeBrowserJson(LOCAL_AUTO_UPLOAD_META_KEY, meta);
    const prev = readBrowserJson<Partial<LocalCacheSnapshot>>(LOCAL_CACHE_STORAGE_KEY) || {};
    writeBrowserJson(LOCAL_CACHE_STORAGE_KEY, {
      ...prev,
      lastAutoUploadDate: meta.lastAutoUploadDate,
      lastUploadedAt: meta.lastUploadedAt,
    });
  } catch {
    // ignore
  }

  try {
    const res = await fetch('/api/local-store/clear-staging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
    if (res.ok) {
      const json = (await res.json()) as { deletedStagingFile?: boolean };
      return {
        serverFileActive: true,
        deletedStagingFile: Boolean(json.deletedStagingFile),
      };
    }
  } catch {
    // static fallback
  }

  return {
    serverFileActive: false,
    deletedStagingFile: true,
  };
}
