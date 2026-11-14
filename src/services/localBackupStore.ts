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
export const LOCAL_PARCELS_BACKUP_STORAGE_KEY = 'spms_parcels_backup_v5';

const IDB_NAME = 'spms_student_backup_db';
const IDB_VERSION = 2;
const IDB_STORE = 'student_backup_store';
const IDB_PARCELS_STORE = 'parcel_backup_store';
const IDB_ALL_STUDENTS_KEY = 'all_students_backup';
const IDB_ALL_PARCELS_KEY = 'all_parcels_backup';

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

export interface ParcelBackupRecord {
  parcels: Parcel[];
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
  parcelsBackup: ParcelBackupRecord;
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
        if (!database.objectStoreNames.contains(IDB_PARCELS_STORE)) {
          database.createObjectStore(IDB_PARCELS_STORE);
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

async function writeParcelsToIdb(payload: {
  parcels: Parcel[];
  updatedAt: string;
  source: string;
}): Promise<boolean> {
  const database = await openStudentBackupIdb();
  if (!database) return false;
  return new Promise((resolve) => {
    try {
      if (!database.objectStoreNames.contains(IDB_PARCELS_STORE)) {
        database.close();
        resolve(false);
        return;
      }
      const tx = database.transaction(IDB_PARCELS_STORE, 'readwrite');
      const store = tx.objectStore(IDB_PARCELS_STORE);
      store.put(payload, IDB_ALL_PARCELS_KEY);
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

async function readParcelsFromIdb(): Promise<{
  parcels: Parcel[];
  updatedAt: string | null;
  source: string | null;
  indexedDbActive: boolean;
}> {
  const database = await openStudentBackupIdb();
  if (!database) {
    return { parcels: [], updatedAt: null, source: null, indexedDbActive: false };
  }
  return new Promise((resolve) => {
    try {
      if (!database.objectStoreNames.contains(IDB_PARCELS_STORE)) {
        database.close();
        resolve({ parcels: [], updatedAt: null, source: null, indexedDbActive: false });
        return;
      }
      const tx = database.transaction(IDB_PARCELS_STORE, 'readonly');
      const store = tx.objectStore(IDB_PARCELS_STORE);
      const req = store.get(IDB_ALL_PARCELS_KEY);
      req.onsuccess = () => {
        const val = req.result as
          | { parcels?: Parcel[]; updatedAt?: string; source?: string }
          | undefined;
        database.close();
        resolve({
          parcels: Array.isArray(val?.parcels) ? val.parcels : [],
          updatedAt: val?.updatedAt || null,
          source: val?.source || null,
          indexedDbActive: true,
        });
      };
      req.onerror = () => {
        database.close();
        resolve({ parcels: [], updatedAt: null, source: null, indexedDbActive: false });
      };
    } catch {
      database.close();
      resolve({ parcels: [], updatedAt: null, source: null, indexedDbActive: false });
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
 * บันทึกข้อมูลพัสดุทั้งหมดรวมทุก User ลงฐานข้อมูลสำรอง (data/parcels-backup.json + IndexedDB + localStorage)
 */
export async function saveAllParcelsToBackupDb(
  parcels: Parcel[],
  source: string = 'parcel_backup_db',
  replaceAll: boolean = false
): Promise<ParcelBackupRecord> {
  const nowIso = new Date().toISOString();
  const sorted = [...parcels].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  writeBrowserJson(LOCAL_PARCELS_BACKUP_STORAGE_KEY, {
    updatedAt: nowIso,
    source,
    parcels: sorted,
  });

  const indexedDbActive = await writeParcelsToIdb({
    parcels: sorted,
    updatedAt: nowIso,
    source,
  });

  try {
    const res = await fetch('/api/local-store/parcels-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcels: sorted, source, replaceAll }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        filePath?: string;
        updatedAt?: string;
        count?: number;
      };
      return {
        parcels: sorted,
        count: json.count ?? sorted.length,
        updatedAt: json.updatedAt || nowIso,
        source,
        filePath: json.filePath || 'data/parcels-backup.json',
        serverFileActive: true,
        indexedDbActive,
      };
    }
  } catch {
    // static / offline fallback
  }

  return {
    parcels: sorted,
    count: sorted.length,
    updatedAt: nowIso,
    source,
    filePath: indexedDbActive
      ? 'IndexedDB:spms_student_backup_db/parcel_backup_store'
      : `localStorage:${LOCAL_PARCELS_BACKUP_STORAGE_KEY}`,
    serverFileActive: false,
    indexedDbActive,
  };
}

/**
 * โหลดข้อมูลพัสดุทั้งหมดรวมทุก User จากฐานข้อมูลสำรอง
 */
export async function loadAllParcelsFromBackupDb(): Promise<ParcelBackupRecord> {
  const browserBackup = readBrowserJson<{
    parcels?: Parcel[];
    updatedAt?: string;
    source?: string;
  }>(LOCAL_PARCELS_BACKUP_STORAGE_KEY);
  const idbBackup = await readParcelsFromIdb();

  try {
    const res = await fetch('/api/local-store/parcels-backup', { method: 'GET' });
    if (res.ok) {
      const json = (await res.json()) as {
        filePath?: string;
        updatedAt?: string | null;
        source?: string | null;
        parcels?: Parcel[];
      };
      const serverParcels = Array.isArray(json.parcels) ? json.parcels : [];
      const bestParcels =
        serverParcels.length > 0
          ? serverParcels
          : idbBackup.parcels.length > 0
          ? idbBackup.parcels
          : browserBackup?.parcels || [];

      return {
        parcels: bestParcels,
        count: bestParcels.length,
        updatedAt: json.updatedAt || idbBackup.updatedAt || browserBackup?.updatedAt || null,
        source: json.source || idbBackup.source || browserBackup?.source || null,
        filePath: json.filePath || 'data/parcels-backup.json',
        serverFileActive: true,
        indexedDbActive: idbBackup.indexedDbActive,
      };
    }
  } catch {
    // static fallback
  }

  const bestParcels =
    idbBackup.parcels.length > 0 ? idbBackup.parcels : browserBackup?.parcels || [];
  return {
    parcels: bestParcels,
    count: bestParcels.length,
    updatedAt: idbBackup.updatedAt || browserBackup?.updatedAt || null,
    source: idbBackup.source || browserBackup?.source || null,
    filePath: idbBackup.indexedDbActive
      ? 'IndexedDB:spms_student_backup_db/parcel_backup_store'
      : `localStorage:${LOCAL_PARCELS_BACKUP_STORAGE_KEY}`,
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
  const browserParcelsBackup = readBrowserJson<{
    parcels?: Parcel[];
    updatedAt?: string;
    source?: string;
  }>(LOCAL_PARCELS_BACKUP_STORAGE_KEY);
  const idbBackup = await readStudentsFromIdb();
  const idbParcelsBackup = await readParcelsFromIdb();

  try {
    const res = await fetch('/api/local-store/load', { method: 'GET' });
    if (res.ok) {
      const json = (await res.json()) as {
        hasServerStore?: boolean;
        stagingFileExists?: boolean;
        stagingFilePath?: string;
        cacheFilePath?: string;
        studentsBackupFilePath?: string;
        parcelsBackupFilePath?: string;
        pendingWrites?: PendingWriteItem[];
        cache?: Partial<LocalCacheSnapshot> | null;
        studentsBackup?: {
          students?: Student[];
          updatedAt?: string;
          source?: string;
        } | null;
        parcelsBackup?: {
          parcels?: Parcel[];
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
      } else {
        try {
          localStorage.removeItem(LOCAL_STAGING_STORAGE_KEY);
        } catch {
          // ignore
        }
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

      const serverBackupParcels = Array.isArray(json.parcelsBackup?.parcels)
        ? json.parcelsBackup.parcels
        : [];
      const serverCache = json.cache;

      // รวมพัสดุจาก Server + Browser + IndexedDB (รวมทุก User)
      const parcelUnionMap = new Map<string, Parcel>();
      for (const p of browserParcelsBackup?.parcels || []) {
        const pid = p.id || p.trackingNumber;
        if (pid) parcelUnionMap.set(pid, p);
      }
      for (const p of idbParcelsBackup.parcels) {
        const pid = p.id || p.trackingNumber;
        if (pid) parcelUnionMap.set(pid, p);
      }
      for (const p of browserCache?.parcels || []) {
        const pid = p.id || p.trackingNumber;
        if (pid) parcelUnionMap.set(pid, p);
      }
      for (const p of serverCache?.parcels || []) {
        const pid = p.id || p.trackingNumber;
        if (pid) parcelUnionMap.set(pid, p);
      }
      for (const p of serverBackupParcels) {
        const pid = p.id || p.trackingNumber;
        if (pid) parcelUnionMap.set(pid, p);
      }
      const resolvedParcels = Array.from(parcelUnionMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const resolvedCacheStudents =
        Array.isArray(serverCache?.students) && serverCache.students.length > 0
          ? serverCache.students
          : browserCache?.students && browserCache.students.length > 0
          ? browserCache.students
          : resolvedBackupStudents;

      const mergedCache: LocalCacheSnapshot | null =
        serverCache || browserCache || resolvedBackupStudents.length > 0 || resolvedParcels.length > 0
          ? {
              students: resolvedCacheStudents,
              parcels: resolvedParcels,
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

      if (serverBackupParcels.length === 0 && resolvedParcels.length > 0) {
        void fetch('/api/local-store/parcels-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parcels: resolvedParcels,
            source: 'auto_recovered_from_browser_backup',
          }),
        }).catch(() => undefined);
      }
      if (resolvedParcels.length > 0) {
        void writeParcelsToIdb({
          parcels: resolvedParcels,
          updatedAt: json.parcelsBackup?.updatedAt || new Date().toISOString(),
          source: json.parcelsBackup?.source || 'merged_multi_user_backup',
        });
      }
      if (serverBackupStudents.length === 0 && finalBackupStudents.length > 0) {
        void fetch('/api/local-store/students-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            students: finalBackupStudents,
            source: 'auto_recovered_from_browser_backup',
          }),
        }).catch(() => undefined);
      }

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
        parcelsBackup: {
          parcels: resolvedParcels,
          count: resolvedParcels.length,
          updatedAt:
            json.parcelsBackup?.updatedAt ||
            idbParcelsBackup.updatedAt ||
            browserParcelsBackup?.updatedAt ||
            null,
          source:
            json.parcelsBackup?.source ||
            idbParcelsBackup.source ||
            browserParcelsBackup?.source ||
            null,
          filePath: json.parcelsBackupFilePath || 'data/parcels-backup.json',
          serverFileActive: Boolean(json.hasServerStore),
          indexedDbActive: idbParcelsBackup.indexedDbActive,
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

  const bestParcelsBackup =
    idbParcelsBackup.parcels.length > 0
      ? idbParcelsBackup.parcels
      : browserParcelsBackup?.parcels && browserParcelsBackup.parcels.length > 0
      ? browserParcelsBackup.parcels
      : browserCache?.parcels || [];

  return {
    serverFileActive: false,
    stagingFileExists: browserStaging.length > 0,
    stagingFilePath: 'localStorage:spms_local_staging_v5',
    cacheFilePath: 'localStorage:spms_local_backup_cache_v5',
    pendingWrites: browserStaging,
    cache:
      browserCache || bestStudentsBackup.length > 0 || bestParcelsBackup.length > 0
        ? {
            students:
              browserCache?.students && browserCache.students.length > 0
                ? browserCache.students
                : bestStudentsBackup,
            parcels:
              browserCache?.parcels && browserCache.parcels.length > 0
                ? browserCache.parcels
                : bestParcelsBackup,
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
    parcelsBackup: {
      parcels: bestParcelsBackup,
      count: bestParcelsBackup.length,
      updatedAt: idbParcelsBackup.updatedAt || browserParcelsBackup?.updatedAt || null,
      source: idbParcelsBackup.source || browserParcelsBackup?.source || null,
      filePath: idbParcelsBackup.indexedDbActive
        ? 'IndexedDB:spms_student_backup_db/parcel_backup_store'
        : `localStorage:${LOCAL_PARCELS_BACKUP_STORAGE_KEY}`,
      serverFileActive: false,
      indexedDbActive: idbParcelsBackup.indexedDbActive,
    },
  };
}

/**
 * บันทึกข้อมูลที่รออัปโหลดลงไฟล์สำรองในระบบ (data/pending-upload-backup.json + localStorage)
 */
export async function saveStagedWritesToLocalFile(
  pendingWrites: PendingWriteItem[],
  cache?: Partial<LocalCacheSnapshot>,
  options?: {
    appendItems?: PendingWriteItem[];
    replacePending?: boolean;
    replaceCacheParcels?: boolean;
  }
): Promise<{
  serverFileActive: boolean;
  stagingFileExists: boolean;
  mergedPendingWrites?: PendingWriteItem[];
}> {
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
    const nowIso = new Date().toISOString();
    if (Array.isArray(cache.students)) {
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
    if (Array.isArray(cache.parcels)) {
      writeBrowserJson(LOCAL_PARCELS_BACKUP_STORAGE_KEY, {
        updatedAt: nowIso,
        source: 'auto_stage_parcel_backup',
        parcels: cache.parcels,
      });
      void writeParcelsToIdb({
        parcels: cache.parcels,
        updatedAt: nowIso,
        source: 'auto_stage_parcel_backup',
      });
    }
  }

  try {
    const res = await fetch('/api/local-store/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pendingWrites,
        appendItems: options?.appendItems,
        replacePending: options?.replacePending,
        replaceCacheParcels: options?.replaceCacheParcels,
        cache,
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        stagingFileExists?: boolean;
        pendingWrites?: PendingWriteItem[];
      };
      if (Array.isArray(json.pendingWrites) && json.pendingWrites.length > 0) {
        writeBrowserJson(LOCAL_STAGING_STORAGE_KEY, json.pendingWrites);
      }
      return {
        serverFileActive: true,
        stagingFileExists: Boolean(json.stagingFileExists),
        mergedPendingWrites: Array.isArray(json.pendingWrites) ? json.pendingWrites : pendingWrites,
      };
    }
  } catch {
    // static fallback
  }

  return {
    serverFileActive: false,
    stagingFileExists: pendingWrites.length > 0,
    mergedPendingWrites: pendingWrites,
  };
}

/**
 * บันทึกแคชค้นหาในระบบ (data/local-search-cache.json + localStorage + IndexedDB นักเรียน/พัสดุ)
 */
export async function saveLocalSearchCache(cache: Partial<LocalCacheSnapshot>): Promise<void> {
  const prev = readBrowserJson<Partial<LocalCacheSnapshot>>(LOCAL_CACHE_STORAGE_KEY) || {};
  writeBrowserJson(LOCAL_CACHE_STORAGE_KEY, { ...prev, ...cache });
  const nowIso = new Date().toISOString();

  if (Array.isArray(cache.students) && cache.students.length > 0) {
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

  if (Array.isArray(cache.parcels)) {
    writeBrowserJson(LOCAL_PARCELS_BACKUP_STORAGE_KEY, {
      updatedAt: nowIso,
      source: 'auto_cache_parcel_backup',
      parcels: cache.parcels,
    });
    await writeParcelsToIdb({
      parcels: cache.parcels,
      updatedAt: nowIso,
      source: 'auto_cache_parcel_backup',
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
 * (ไม่ลบไฟล์ฐานข้อมูลสำรองรายชื่อนักเรียน data/students-backup.json และ data/parcels-backup.json)
 */
export async function clearStagedBackupAfterUpload(meta: {
  lastAutoUploadDate: string | null;
  lastUploadedAt: string;
  uploadedKeys?: string[];
}): Promise<{
  serverFileActive: boolean;
  deletedStagingFile: boolean;
  remainingPending?: PendingWriteItem[];
}> {
  try {
    writeBrowserJson(LOCAL_AUTO_UPLOAD_META_KEY, {
      lastAutoUploadDate: meta.lastAutoUploadDate,
      lastUploadedAt: meta.lastUploadedAt,
    });
    const prev = readBrowserJson<Partial<LocalCacheSnapshot>>(LOCAL_CACHE_STORAGE_KEY) || {};
    writeBrowserJson(LOCAL_CACHE_STORAGE_KEY, {
      ...prev,
      lastAutoUploadDate: meta.lastAutoUploadDate,
      lastUploadedAt: meta.lastUploadedAt,
    });
    localStorage.removeItem(LOCAL_STAGING_STORAGE_KEY);
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
      const json = (await res.json()) as {
        deletedStagingFile?: boolean;
        remainingPending?: PendingWriteItem[];
      };
      const rem = Array.isArray(json.remainingPending) ? json.remainingPending : [];
      if (rem.length > 0) {
        writeBrowserJson(LOCAL_STAGING_STORAGE_KEY, rem);
      }
      return {
        serverFileActive: true,
        deletedStagingFile: Boolean(json.deletedStagingFile),
        remainingPending: rem,
      };
    }
  } catch {
    // static fallback
  }

  return {
    serverFileActive: false,
    deletedStagingFile: true,
    remainingPending: [],
  };
}
