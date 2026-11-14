import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Student,
  Parcel,
  ParcelCategory,
  ParcelStatus,
  Member,
  MemberRole,
  RolePermission,
  AppMenuKey,
  ALL_MENU_KEYS,
  DEFAULT_STAFF_MENU_KEYS,
  DEFAULT_TEACHER_MENU_KEYS,
  INITIAL_MEMBERS,
  INITIAL_ROLE_PERMISSIONS,
  PendingWriteItem,
  LocalBackupStatus,
  StudentBackupStatus,
  ParcelBackupStatus,
  ParcelBackupSummary,
  UserParcelBackupStat,
  FirestoreConnectionStatus,
  QuotaMetrics,
  getRelativeDateString,
  extractParcelLocalYMD,
  isUnknownOwnerParcel,
  StudentParcelCountStats,
  WEEKLY_PARCEL_WARNING_LIMIT,
  ParcelRateLimitConfig,
  DEFAULT_PARCEL_RATE_LIMIT_CONFIG,
  WriteTargetMode,
  FirestoreQuotaStatus,
  isStudentOverConfiguredLimit,
  getStudentParcelCountStats,
  buildAllStudentParcelStats,
  formatStudentCode,
  isSixDigitsTrackingNumber,
} from '../types/parcel';
import {
  auth,
  User,
  onAuthStateChanged,
  signInWithGooglePopup,
  signOutFirebaseUser,
  initializeDefaultCloudDataIfEmpty,
  fetchCloudDataDirectly,
  uploadPendingWritesBatchToFirestore,
  findStudentInFirestoreFallback,
  findParcelInFirestoreFallback,
  checkFirestoreQuotaStatus,
  isFirestoreQuotaError,
  sanitizeId,
  AUTO_CLOUD_EMAIL,
  AUTO_CLOUD_OWNER_ID,
} from '../services/firebase';
import {
  loadLocalBackupStore,
  saveStagedWritesToLocalFile,
  saveLocalSearchCache,
  clearStagedBackupAfterUpload,
  saveAllStudentsToBackupDb,
  loadAllStudentsFromBackupDb,
  saveAllParcelsToBackupDb,
  loadAllParcelsFromBackupDb,
  getLocalTodayYMD,
  getNextMidnightScheduleInfo,
  LOCAL_STAGING_STORAGE_KEY,
  LocalCacheSnapshot,
} from '../services/localBackupStore';

// รายการคีย์ LocalStorage เก่าที่ต้องลบทิ้งเมื่ออัปเกรดโครงสร้างใหม่
const STORAGE_KEYS_TO_PURGE = [
  'spms_students_cache_v1',
  'spms_parcels_cache_v1',
  'spms_pending_writes_v1',
  'spms_quota_metrics_v1',
  'spms_students_prod_v2',
  'spms_parcels_prod_v2',
  'spms_pending_writes_prod_v2',
  'spms_quota_metrics_prod_v2',
  'spms_sync_mode_clean_v3',
  'spms_students_clean_v3',
  'spms_parcels_clean_v3',
  'spms_members_clean_v1',
  'spms_role_permissions_clean_v1',
  'spms_pending_writes_clean_v3',
  'spms_quota_metrics_clean_v3',
  'spms_sync_mode_auto_v4',
];

// เก็บเฉพาะรหัสสมาชิกที่ล็อกอินค้างไว้ เพื่อไม่ให้ผู้ใช้งานถูกเด้งออกจากระบบทุกครั้งที่รีเฟรชหน้าจอ
const SESSION_MEMBER_KEY = 'spms_session_member_id_v2';

export type SyncMode = 'staged_midnight_sync';

export interface NewParcelInput {
  trackingNumber: string;
  studentCode: string;
  category: ParcelCategory;
  status: ParcelStatus;
  courier: string;
  note: string;
  isSixDigitsInput?: boolean;
  customStudent?: {
    studentFullName: string;
    nickname: string;
    gradeRoom: string;
    dormitory: string;
    dormRoom: string;
    bed: string;
  };
}

export interface UpsertMemberInput {
  memberId?: string;
  username: string;
  password: string;
  fullName: string;
  role: MemberRole;
  allowedMenus: AppMenuKey[];
  useCustomMenus: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  active: boolean;
}

export interface WeeklyWarningPopupState {
  isOpen: boolean;
  focusedStudent: StudentParcelCountStats | null;
  triggerReason?: 'inbound_added' | 'student_lookup' | 'auto_detect' | 'manual' | 'test_preview';
  customWarningMessage?: string;
  exceededReasons?: string[];
}

interface ParcelSystemContextValue {
  user: User | null;
  connectedEmail: string;
  authReady: boolean;
  currentMember: Member | null;
  members: Member[];
  rolePermissions: RolePermission[];
  allowedMenusForCurrentMember: AppMenuKey[];
  canCurrentMemberEdit: boolean;
  canCurrentMemberDelete: boolean;
  loginWithCredentials: (username: string, password: string) => { success: boolean; message: string };
  loginWithGoogleAccount: () => Promise<{ success: boolean; message: string }>;
  logoutMember: () => void;
  upsertMember: (input: UpsertMemberInput) => Promise<Member>;
  deleteMember: (memberId: string) => Promise<void>;
  updateRolePermission: (
    roleId: 'admin' | 'staff' | 'teacher' | 'user',
    allowedMenus: AppMenuKey[],
    canEdit?: boolean,
    canDelete?: boolean
  ) => Promise<void>;
  getEffectiveMemberMenus: (member: Member) => AppMenuKey[];
  students: Student[];
  studentMap: Map<string, Student>;
  parcels: Parcel[];
  parcelRateLimitConfig: ParcelRateLimitConfig;
  updateParcelRateLimitConfig: (config: ParcelRateLimitConfig) => Promise<void>;
  studentParcelStatsMap: Map<string, StudentParcelCountStats>;
  allStudentParcelStats: StudentParcelCountStats[];
  overWeeklyLimitStudents: StudentParcelCountStats[];
  overLimitStudents: StudentParcelCountStats[];
  getStudentParcelCounts: (
    studentCode?: string,
    studentFullName?: string,
    studentMeta?: Partial<Student>
  ) => StudentParcelCountStats;
  weeklyWarningPopup: WeeklyWarningPopupState;
  openWeeklyWarningPopup: (
    focusedStudent?: StudentParcelCountStats | null,
    reason?: WeeklyWarningPopupState['triggerReason'],
    customMessage?: string,
    customReasons?: string[]
  ) => void;
  closeWeeklyWarningPopup: () => void;
  pendingWrites: PendingWriteItem[];
  localBackupStatus: LocalBackupStatus;
  studentBackupStatus: StudentBackupStatus;
  parcelBackupStatus: ParcelBackupStatus;
  parcelBackupSummary: ParcelBackupSummary;
  firestoreConnectionStatus: FirestoreConnectionStatus;
  lastQuotaCheckAt: string | null;
  lastWriteMode: WriteTargetMode;
  quotaMetrics: QuotaMetrics;
  syncMode: SyncMode;
  isSyncing: boolean;
  quotaExceeded: boolean;
  syncProgress: { completed: number; total: number } | null;
  toastMessage: { text: string; type: 'success' | 'info' | 'warning' | 'error' } | null;
  clearToast: () => void;
  setSyncMode: (mode: SyncMode) => void;
  recheckFirestoreQuota: () => Promise<FirestoreQuotaStatus>;
  exportLocalStoragePendingJson: () => void;
  exportLocalStorageParcelsCsv: () => void;
  lookupStudentByCode: (code: string) => Student | undefined;
  lookupStudentWithCloudFallback: (code: string) => Promise<{
    student: Student | undefined;
    source: 'local' | 'firebase' | 'none';
  }>;
  searchStudentsLocal: (keyword: string) => Student[];
  searchParcelsLocal: (keyword: string, statusFilter?: string, dormFilter?: string, dateFilter?: string) => Parcel[];
  searchParcelsWithCloudFallback: (
    keyword: string,
    statusFilter?: string,
    dormFilter?: string,
    dateFilter?: string
  ) => Promise<{ parcels: Parcel[]; source: 'local' | 'firebase' }>;
  recordLocalSearchSaving: () => void;
  addInboundParcel: (input: NewParcelInput) => Promise<Parcel & { writeMode?: WriteTargetMode }>;
  updateParcelStatus: (parcelId: string, newStatus: ParcelStatus, note?: string, deliveredDate?: string) => Promise<void>;
  updateParcelDetails: (parcelId: string, updates: Partial<Parcel>) => Promise<void>;
  bulkUpdateParcelStatus: (parcelIds: string[], newStatus: ParcelStatus, deliveredDate?: string) => Promise<void>;
  deleteParcel: (parcelId: string) => Promise<void>;
  bulkDeleteParcels: (parcelIds: string[], reasonLabel?: string) => Promise<number>;
  bulkDeleteParcelsByDorm: (dormitory: string, statusFilter?: string) => Promise<number>;
  clearAllParcels: () => Promise<number>;
  bulkImportParcels: (parcels: (Parcel | Omit<Parcel, 'createdAt' | 'updatedAt'>)[]) => Promise<number>;
  fullRestoreSystemBackup: (
    backupData: { students?: Student[]; parcels?: Parcel[] },
    replaceAll?: boolean
  ) => Promise<{ studentsCount: number; parcelsCount: number }>;
  bulkImportStudents: (newStudents: Omit<Student, 'ownerId' | 'createdAt' | 'updatedAt'>[], stageForCloudSync?: boolean) => Promise<number>;
  upsertSingleStudent: (student: Omit<Student, 'ownerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  deleteStudent: (studentCode: string) => Promise<void>;
  bulkDeleteStudents: (studentCodes: string[], targetLabel?: string) => Promise<void>;
  clearAllStudents: () => Promise<void>;
  backupAllStudentsNow: () => Promise<StudentBackupStatus>;
  restoreStudentsFromBackupDb: () => Promise<number>;
  stageAllBackupParcelsForUpload: () => Promise<number>;
  uploadAllBackupParcelsToFirebaseNow: () => Promise<void>;
  refreshFromLocalBackupServer: () => Promise<void>;
  syncPendingToFirebase: () => Promise<void>;
  uploadStagedToFirebaseNow: () => Promise<void>;
  pullFromFirebaseToLocal: () => Promise<void>;
  clearAllLocalData: () => void;
  signInGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const ParcelSystemContext = createContext<ParcelSystemContextValue | undefined>(undefined);

// ผู้ใช้ Workspace อัตโนมัติภายใต้บัญชี Tasawan_app01@pcccr.ac.th
const AUTO_BOUND_USER = {
  uid: AUTO_CLOUD_OWNER_ID,
  email: AUTO_CLOUD_EMAIL,
  displayName: AUTO_CLOUD_EMAIL,
  emailVerified: true,
  isAnonymous: false,
} as unknown as User;

function purgeLocalMachineData(): void {
  try {
    for (const key of STORAGE_KEYS_TO_PURGE) {
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn('Local storage purge warning:', err);
  }
}

export const ParcelSystemProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseAuthUser, setFirebaseAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(true);

  const user = useMemo<User>(() => firebaseAuthUser || AUTO_BOUND_USER, [firebaseAuthUser]);
  const connectedEmail = AUTO_CLOUD_EMAIL;

  // ข้อมูลทั้งหมดโหลดโดยตรงจาก Firestore ไม่เก็บไว้ใน LocalStorage บนเครื่อง
  const [students, setStudents] = useState<Student[]>([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [members, setMembers] = useState<Member[]>(INITIAL_MEMBERS);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>(INITIAL_ROLE_PERMISSIONS);
  const [parcelRateLimitConfig, setParcelRateLimitConfig] = useState<ParcelRateLimitConfig>(() => {
    try {
      const saved = localStorage.getItem('spms_rate_limit_config_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            daily: {
              enabled: Boolean(parsed.daily?.enabled),
              limit: Math.max(0, Number(parsed.daily?.limit) || 1),
            },
            weekly: {
              enabled: Boolean(parsed.weekly?.enabled),
              limit: Math.max(0, Number(parsed.weekly?.limit) || 3),
            },
            monthly: {
              enabled: Boolean(parsed.monthly?.enabled),
              limit: Math.max(0, Number(parsed.monthly?.limit) || 10),
            },
          };
        }
      }
    } catch {
      // fallback
    }
    return DEFAULT_PARCEL_RATE_LIMIT_CONFIG;
  });

  // รหัสสมาชิกปัจจุบันสำหรับการล็อกอิน
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SESSION_MEMBER_KEY) || null;
    } catch {
      return null;
    }
  });

  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);
  const [firestoreConnectionStatus, setFirestoreConnectionStatus] =
    useState<FirestoreConnectionStatus>('connected');
  const [lastQuotaCheckAt, setLastQuotaCheckAt] = useState<string | null>(null);
  const [lastWriteMode, setLastWriteMode] = useState<WriteTargetMode>('firestore_direct');
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);
  const hasShownQuotaNoticeRef = useRef<boolean>(false);
  const hasBootstrappedRef = useRef<boolean>(false);
  const isUploadingRef = useRef<boolean>(false);
  const lastQuotaProbeTimeRef = useRef<number>(0);
  const quotaExceededRef = useRef<boolean>(false);
  const firestoreConnectionStatusRef = useRef<FirestoreConnectionStatus>('connected');

  const [pendingWrites, setPendingWrites] = useState<PendingWriteItem[]>([]);
  const [localBackupStatus, setLocalBackupStatus] = useState<LocalBackupStatus>(() => ({
    serverFileActive: false,
    stagingFileExists: false,
    stagingFilePath: 'data/pending-upload-backup.json',
    cacheFilePath: 'data/local-search-cache.json',
    stagedCount: 0,
    lastAutoUploadDate: null,
    lastUploadedAt: null,
    nextScheduledUploadAt: getNextMidnightScheduleInfo().isoString,
  }));
  const [studentBackupStatus, setStudentBackupStatus] = useState<StudentBackupStatus>({
    count: 0,
    updatedAt: null,
    filePath: 'data/students-backup.json',
    serverFileActive: false,
    indexedDbActive: false,
    source: null,
  });
  const [parcelBackupStatus, setParcelBackupStatus] = useState<ParcelBackupStatus>({
    count: 0,
    updatedAt: null,
    filePath: 'data/parcels-backup.json',
    serverFileActive: false,
    indexedDbActive: false,
    source: null,
  });

  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: 'success' | 'info' | 'warning' | 'error';
  } | null>(null);
  const [weeklyWarningPopup, setWeeklyWarningPopup] = useState<WeeklyWarningPopupState>({
    isOpen: false,
    focusedStudent: null,
  });

  const [quotaMetrics, setQuotaMetrics] = useState<QuotaMetrics>({
    localLookupsSaved: 0,
    batchedWritesQueued: 0,
    firestoreReadsUsed: 0,
    firestoreWritesUsed: 0,
    lastSyncedAt: null,
  });

  // โหมดพักข้อมูลในไฟล์สำรองของระบบก่อน แล้วอัปโหลดขึ้น Firebase อัตโนมัติเวลา 00.00 น. ทุกวัน
  const syncMode: SyncMode = 'staged_midnight_sync';

  // Refs สำหรับเข้าถึงข้อมูลล่าสุดภายใน callbacks / timers
  const studentsRef = useRef<Student[]>(students);
  const parcelsRef = useRef<Parcel[]>(parcels);
  const membersRef = useRef<Member[]>(members);
  const currentMemberIdRef = useRef<string | null>(currentMemberId);
  const rolePermissionsRef = useRef<RolePermission[]>(rolePermissions);
  const rateLimitRef = useRef<ParcelRateLimitConfig>(parcelRateLimitConfig);
  const pendingWritesRef = useRef<PendingWriteItem[]>(pendingWrites);
  const localBackupStatusRef = useRef<LocalBackupStatus>(localBackupStatus);

  useEffect(() => {
    studentsRef.current = students;
  }, [students]);
  useEffect(() => {
    parcelsRef.current = parcels;
  }, [parcels]);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  useEffect(() => {
    currentMemberIdRef.current = currentMemberId;
  }, [currentMemberId]);
  useEffect(() => {
    rolePermissionsRef.current = rolePermissions;
  }, [rolePermissions]);
  useEffect(() => {
    rateLimitRef.current = parcelRateLimitConfig;
  }, [parcelRateLimitConfig]);
  useEffect(() => {
    pendingWritesRef.current = pendingWrites;
  }, [pendingWrites]);
  useEffect(() => {
    localBackupStatusRef.current = localBackupStatus;
  }, [localBackupStatus]);

  const getCurrentActorAttribution = useCallback(() => {
    const activeId = currentMemberIdRef.current;
    const matched = activeId
      ? membersRef.current.find((m) => m.memberId === activeId && m.active)
      : null;
    if (!matched) {
      return {
        memberId: 'shared_system',
        name: 'ระบบสำรองกลาง',
        role: 'ระบบ',
      };
    }
    return {
      memberId: matched.memberId,
      name: matched.fullName || matched.username || matched.role,
      role: matched.role,
    };
  }, []);

  const showToast = useCallback(
    (text: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
      setToastMessage({ text, type });
    },
    []
  );

  const clearToast = useCallback(() => setToastMessage(null), []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // ติดตามสถานะ Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setFirebaseAuthUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // บันทึกเฉพาะ Session ID ของสมาชิกที่ล็อกอินอยู่
  useEffect(() => {
    try {
      if (currentMemberId) {
        localStorage.setItem(SESSION_MEMBER_KEY, currentMemberId);
      } else {
        localStorage.removeItem(SESSION_MEMBER_KEY);
      }
    } catch {
      // ignore
    }
  }, [currentMemberId]);

  // ล้างคีย์เก่าที่เลิกใช้งานแล้ว
  useEffect(() => {
    purgeLocalMachineData();
  }, []);

  useEffect(() => {
    quotaExceededRef.current = quotaExceeded;
  }, [quotaExceeded]);

  useEffect(() => {
    firestoreConnectionStatusRef.current = firestoreConnectionStatus;
  }, [firestoreConnectionStatus]);

  const handleQuotaExceeded = useCallback((forceToast = false) => {
    setQuotaExceeded(true);
    quotaExceededRef.current = true;
    setFirestoreConnectionStatus('quota_exceeded');
    firestoreConnectionStatusRef.current = 'quota_exceeded';
    setLastWriteMode('local_storage_quota_full');
    setIsSyncing(false);
    if (forceToast || !hasShownQuotaNoticeRef.current) {
      hasShownQuotaNoticeRef.current = true;
      showToast(
        'โควตา Firestore เต็มแล้ว — ระบบบันทึกลง localStorage อัตโนมัติ สามารถกดส่งออกไฟล์หรืออัปโหลดเข้า Firestore ได้ภายหลัง',
        'warning'
      );
    }
  }, [showToast]);

  // ตรวจสอบสถานะ Quota ของ Firestore (มีแคช 45 วินาทีเมื่อโควตาปกติ เพื่อไม่ให้เปลือง Read ตอนสแกนต่อเนื่อง)
  const checkAndSyncQuotaStatus = useCallback(
    async (force = false): Promise<FirestoreQuotaStatus> => {
      const nowMs = Date.now();
      const cacheTtlMs = quotaExceededRef.current ? 180_000 : 45_000;
      if (!force && lastQuotaProbeTimeRef.current > 0 && nowMs - lastQuotaProbeTimeRef.current < cacheTtlMs) {
        return {
          available: !quotaExceededRef.current && firestoreConnectionStatusRef.current === 'connected',
          quotaExceeded: quotaExceededRef.current,
          connectionFailed: firestoreConnectionStatusRef.current === 'offline_fallback',
          checkedAt: new Date(lastQuotaProbeTimeRef.current).toISOString(),
        };
      }

      const status = await checkFirestoreQuotaStatus();
      lastQuotaProbeTimeRef.current = Date.now();
      setLastQuotaCheckAt(status.checkedAt);

      if (status.quotaExceeded) {
        setQuotaExceeded(true);
        quotaExceededRef.current = true;
        setFirestoreConnectionStatus('quota_exceeded');
        firestoreConnectionStatusRef.current = 'quota_exceeded';
        setLastWriteMode('local_storage_quota_full');
      } else if (status.connectionFailed) {
        setQuotaExceeded(false);
        quotaExceededRef.current = false;
        setFirestoreConnectionStatus('offline_fallback');
        firestoreConnectionStatusRef.current = 'offline_fallback';
        setLastWriteMode('local_storage_offline');
      } else {
        setQuotaExceeded(false);
        quotaExceededRef.current = false;
        hasShownQuotaNoticeRef.current = false;
        setFirestoreConnectionStatus('connected');
        firestoreConnectionStatusRef.current = 'connected';
        setLastWriteMode('firestore_direct');
      }

      return status;
    },
    []
  );

  // ฟังก์ชันรวมรายการที่รออัปโหลดในไฟล์สำรองเข้ากับข้อมูลแคชปัจจุบัน
  const applyPendingItemsToSnapshot = useCallback(
    (
      base: {
        students: Student[];
        parcels: Parcel[];
        members: Member[];
        rolePermissions: RolePermission[];
        rateLimitConfig: ParcelRateLimitConfig;
      },
      items: PendingWriteItem[]
    ) => {
      const studentMapLocal = new Map<string, Student>();
      for (const s of base.students) studentMapLocal.set(s.studentCode, s);

      const parcelMapLocal = new Map<string, Parcel>();
      for (const p of base.parcels) parcelMapLocal.set(p.id || p.trackingNumber, p);

      const memberMapLocal = new Map<string, Member>();
      for (const m of base.members) memberMapLocal.set(m.memberId, m);

      const roleMapLocal = new Map<string, RolePermission>();
      for (const rp of base.rolePermissions) roleMapLocal.set(rp.roleId, rp);

      let nextRateConfig = base.rateLimitConfig;

      for (const item of items) {
        if (item.collection === 'students') {
          if (item.action === 'delete') studentMapLocal.delete(item.docId);
          else if (item.data) studentMapLocal.set(item.docId, item.data as Student);
        } else if (item.collection === 'parcels') {
          if (item.action === 'delete') parcelMapLocal.delete(item.docId);
          else if (item.data) parcelMapLocal.set(item.docId, item.data as Parcel);
        } else if (item.collection === 'members') {
          if (item.action === 'delete') memberMapLocal.delete(item.docId);
          else if (item.data) memberMapLocal.set(item.docId, item.data as Member);
        } else if (item.collection === 'role_permissions') {
          if (item.action === 'delete') roleMapLocal.delete(item.docId);
          else if (item.data) roleMapLocal.set(item.docId, item.data as RolePermission);
        } else if (item.collection === 'system_settings' && item.data) {
          nextRateConfig = item.data as ParcelRateLimitConfig;
        }
      }

      return {
        students: Array.from(studentMapLocal.values()).sort((a, b) => a.seqNo - b.seqNo),
        parcels: Array.from(parcelMapLocal.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
        members: Array.from(memberMapLocal.values()),
        rolePermissions: Array.from(roleMapLocal.values()),
        rateLimitConfig: nextRateConfig,
      };
    },
    []
  );

  // บันทึกรายการเปลี่ยนแปลงลงไฟล์สำรองรออัพโหลด (data/pending-upload-backup.json + data/parcels-backup.json + localStorage) ก่อนขึ้น Firebase
  const stagePendingWrites = useCallback(
    async (
      newItems: PendingWriteItem[],
      nextCache?: {
        students?: Student[];
        parcels?: Parcel[];
        members?: Member[];
        rolePermissions?: RolePermission[];
        rateLimitConfig?: ParcelRateLimitConfig;
      },
      options?: {
        replaceCacheParcels?: boolean;
        replacePending?: boolean;
      }
    ) => {
      const mergedMap = new Map<string, PendingWriteItem>();
      if (!options?.replacePending) {
        for (const item of pendingWritesRef.current) {
          mergedMap.set(`${item.collection}:${item.docId}`, item);
        }
      }
      for (const item of newItems) {
        mergedMap.set(`${item.collection}:${item.docId}`, item);
      }
      const nextPending = Array.from(mergedMap.values());
      pendingWritesRef.current = nextPending;
      setPendingWrites(nextPending);
      setQuotaMetrics((prev) => ({
        ...prev,
        batchedWritesQueued: nextPending.length,
      }));

      const cachePayload = {
        students: nextCache?.students ?? studentsRef.current,
        parcels: nextCache?.parcels ?? parcelsRef.current,
        members: nextCache?.members ?? membersRef.current,
        rolePermissions: nextCache?.rolePermissions ?? rolePermissionsRef.current,
        rateLimitConfig: nextCache?.rateLimitConfig ?? rateLimitRef.current,
        lastSyncedAt: localBackupStatusRef.current.lastUploadedAt,
        lastAutoUploadDate: localBackupStatusRef.current.lastAutoUploadDate,
        lastUploadedAt: localBackupStatusRef.current.lastUploadedAt,
      };

      const res = await saveStagedWritesToLocalFile(nextPending, cachePayload, {
        appendItems: newItems,
        replacePending: options?.replacePending,
        replaceCacheParcels: options?.replaceCacheParcels,
      });

      const finalPending =
        Array.isArray(res.mergedPendingWrites) && res.mergedPendingWrites.length > 0
          ? res.mergedPendingWrites
          : options?.replacePending
          ? nextPending
          : nextPending;

      if (finalPending !== nextPending) {
        pendingWritesRef.current = finalPending;
        setPendingWrites(finalPending);
        setQuotaMetrics((prev) => ({
          ...prev,
          batchedWritesQueued: finalPending.length,
        }));
      }

      if (finalPending.length > nextPending.length && !options?.replaceCacheParcels) {
        const appliedWithServer = applyPendingItemsToSnapshot(
          {
            students: cachePayload.students,
            parcels: cachePayload.parcels,
            members: cachePayload.members,
            rolePermissions: cachePayload.rolePermissions,
            rateLimitConfig: cachePayload.rateLimitConfig,
          },
          finalPending
        );
        setParcels(appliedWithServer.parcels);
        setParcelBackupStatus((prev) => ({
          ...prev,
          count: appliedWithServer.parcels.length,
          updatedAt: new Date().toISOString(),
          serverFileActive: res.serverFileActive || prev.serverFileActive,
          source: 'multi_user_staged_merge',
        }));
      } else if (nextCache?.parcels) {
        setParcelBackupStatus((prev) => ({
          ...prev,
          count: nextCache.parcels!.length,
          updatedAt: new Date().toISOString(),
          serverFileActive: res.serverFileActive || prev.serverFileActive,
          source: 'auto_stage_parcel_backup',
        }));
      }

      setLocalBackupStatus((prev) => ({
        ...prev,
        serverFileActive: res.serverFileActive,
        stagingFileExists: res.stagingFileExists,
        stagedCount: finalPending.length,
        nextScheduledUploadAt: getNextMidnightScheduleInfo().isoString,
      }));
      if (nextCache?.students) {
        setStudentBackupStatus((prev) => ({
          ...prev,
          count: nextCache.students!.length,
          updatedAt: new Date().toISOString(),
          serverFileActive: res.serverFileActive || prev.serverFileActive,
          source: 'auto_stage_backup',
        }));
      }
    },
    [applyPendingItemsToSnapshot]
  );

  /**
   * บันทึกข้อมูลลง Firestore โดยตรงทันที (ไม่ต้องกดตรวจโควตา):
   * - หากบันทึกสำเร็จ: อัปเดตแคชในเครื่องและล้างคิวที่ซ้ำกันใน localStorage
   * - หาก Quota เต็ม หรือเชื่อมต่อไม่ได้: แจ้งเตือนผู้ใช้ทันทีและบันทึกลง localStorage เพื่อให้ส่งออกหรืออัปโหลดเข้า Firestore ภายหลัง
   */
  const commitWritesDirectOrFallbackToLocalStorage = useCallback(
    async (
      items: PendingWriteItem[],
      nextCache?: {
        students?: Student[];
        parcels?: Parcel[];
        members?: Member[];
        rolePermissions?: RolePermission[];
        rateLimitConfig?: ParcelRateLimitConfig;
      },
      options?: {
        replaceCacheParcels?: boolean;
        replacePending?: boolean;
      }
    ): Promise<{ mode: WriteTargetMode; uploadedCount: number }> => {
      let uploadedCount = 0;

      if (items.length > 0) {
        try {
          const result = await uploadPendingWritesBatchToFirestore(
            items,
            AUTO_CLOUD_OWNER_ID
          );
          uploadedCount = result.uploadedCount;

          if (!result.quotaExceeded && !result.connectionFailed) {
            const nowIso = new Date().toISOString();
            const now = new Date();
            setQuotaExceeded(false);
            quotaExceededRef.current = false;
            hasShownQuotaNoticeRef.current = false;
            setFirestoreConnectionStatus('connected');
            firestoreConnectionStatusRef.current = 'connected';
            setLastWriteMode('firestore_direct');
            setLastQuotaCheckAt(nowIso);
            lastQuotaProbeTimeRef.current = Date.now();

            // หากใน localStorage เคยมีคิวซ้ำกับ docId ที่เพิ่งเขียนตรงสำเร็จ ให้เคลียร์เฉพาะคีย์นั้นออก
            const uploadedKeys = new Set(items.map((it) => `${it.collection}:${it.docId}`));
            const hasOverlapInQueue = pendingWritesRef.current.some((p) =>
              uploadedKeys.has(`${p.collection}:${p.docId}`)
            );
            let remainingPendingCount = pendingWritesRef.current.length;
            if (hasOverlapInQueue) {
              const clearRes = await clearStagedBackupAfterUpload({
                lastAutoUploadDate: localBackupStatusRef.current.lastAutoUploadDate,
                lastUploadedAt: nowIso,
                uploadedKeys: Array.from(uploadedKeys),
              });
              const remaining = clearRes.remainingPending || [];
              pendingWritesRef.current = remaining;
              setPendingWrites(remaining);
              remainingPendingCount = remaining.length;
              setLocalBackupStatus((prev) => ({
                ...prev,
                stagingFileExists: remaining.length > 0,
                stagedCount: remaining.length,
                lastUploadedAt: nowIso,
              }));
            }

            setQuotaMetrics((prev) => ({
              ...prev,
              batchedWritesQueued: remainingPendingCount,
              firestoreWritesUsed: prev.firestoreWritesUsed + result.uploadedCount,
              lastSyncedAt: nowIso,
            }));

            // อัปเดตแคชในเครื่อง/IndexedDB เพื่อให้การค้นหายังเป็นแบบ Zero-Read
            const cacheUpdate: Partial<LocalCacheSnapshot> = {
              ...(nextCache?.students !== undefined ? { students: nextCache.students } : {}),
              ...(nextCache?.parcels !== undefined ? { parcels: nextCache.parcels } : {}),
              ...(nextCache?.members !== undefined ? { members: nextCache.members } : {}),
              ...(nextCache?.rolePermissions !== undefined
                ? { rolePermissions: nextCache.rolePermissions }
                : {}),
              ...(nextCache?.rateLimitConfig !== undefined
                ? { rateLimitConfig: nextCache.rateLimitConfig }
                : {}),
              lastSyncedAt: nowIso,
              lastUploadedAt: nowIso,
            };
            await saveLocalSearchCache(cacheUpdate);
            if (options?.replaceCacheParcels && nextCache?.parcels) {
              await saveAllParcelsToBackupDb(
                nextCache.parcels,
                'firestore_direct_sync',
                true
              );
            }
            if (nextCache?.parcels) {
              setParcelBackupStatus((prev) => ({
                ...prev,
                count: nextCache.parcels!.length,
                updatedAt: nowIso,
                source: 'firestore_direct_sync',
              }));
            }
            if (nextCache?.students) {
              setStudentBackupStatus((prev) => ({
                ...prev,
                count: nextCache.students!.length,
                updatedAt: nowIso,
                source: 'firestore_direct_sync',
              }));
            }
            setLocalBackupStatus((prev) => ({
              ...prev,
              lastUploadedAt: nowIso,
              nextScheduledUploadAt: getNextMidnightScheduleInfo(now).isoString,
            }));

            return { mode: 'firestore_direct', uploadedCount: result.uploadedCount };
          }

          if (result.quotaExceeded) {
            handleQuotaExceeded(false);
            lastQuotaProbeTimeRef.current = Date.now();
            setLastQuotaCheckAt(new Date().toISOString());
          } else {
            setFirestoreConnectionStatus('offline_fallback');
            firestoreConnectionStatusRef.current = 'offline_fallback';
          }
        } catch (err) {
          if (isFirestoreQuotaError(err)) {
            handleQuotaExceeded(false);
            lastQuotaProbeTimeRef.current = Date.now();
            setLastQuotaCheckAt(new Date().toISOString());
          } else {
            setFirestoreConnectionStatus('offline_fallback');
            firestoreConnectionStatusRef.current = 'offline_fallback';
          }
        }
      }

      // Quota เต็ม หรือไม่สามารถเชื่อมต่อ Firestore ได้ -> บันทึกรายการที่ยังไม่ได้อัปโหลดลง localStorage ทันที
      const remainingItems =
        uploadedCount > 0 && uploadedCount < items.length
          ? items.slice(uploadedCount)
          : items;
      await stagePendingWrites(remainingItems, nextCache, options);
      const fallbackMode: WriteTargetMode = quotaExceededRef.current
        ? 'local_storage_quota_full'
        : 'local_storage_offline';
      setLastWriteMode(fallbackMode);
      return { mode: fallbackMode, uploadedCount };
    },
    [handleQuotaExceeded, stagePendingWrites]
  );

  // ดึงข้อมูลจาก Firebase (ถ้าเชื่อมต่อไม่ได้หรือ Quota เต็ม ให้สลับไปใช้ฐานข้อมูลสำรองรายชื่อนักเรียนและพัสดุอัตโนมัติ)
  const loadDataDirectlyFromFirestore = useCallback(async (): Promise<{
    success: boolean;
    quotaExceeded?: boolean;
    connectionFailed?: boolean;
  }> => {
    setIsSyncing(true);
    const applyStudentBackupFallback = async (mode: 'quota_exceeded' | 'offline_fallback') => {
      setFirestoreConnectionStatus(mode);
      const [backup, parcelBackup] = await Promise.all([
        loadAllStudentsFromBackupDb(),
        loadAllParcelsFromBackupDb(),
      ]);
      setStudentBackupStatus({
        count: backup.count,
        updatedAt: backup.updatedAt,
        filePath: backup.filePath,
        serverFileActive: backup.serverFileActive,
        indexedDbActive: backup.indexedDbActive,
        source: backup.source,
      });
      setParcelBackupStatus({
        count: parcelBackup.count,
        updatedAt: parcelBackup.updatedAt,
        filePath: parcelBackup.filePath,
        serverFileActive: parcelBackup.serverFileActive,
        indexedDbActive: parcelBackup.indexedDbActive,
        source: parcelBackup.source,
      });

      if (
        (backup.students.length > 0 && studentsRef.current.length === 0) ||
        (parcelBackup.parcels.length > 0 && parcelsRef.current.length === 0)
      ) {
        const applied = applyPendingItemsToSnapshot(
          {
            students: studentsRef.current.length > 0 ? studentsRef.current : backup.students,
            parcels: parcelsRef.current.length > 0 ? parcelsRef.current : parcelBackup.parcels,
            members: membersRef.current,
            rolePermissions: rolePermissionsRef.current,
            rateLimitConfig: rateLimitRef.current,
          },
          pendingWritesRef.current
        );
        if (studentsRef.current.length === 0 && applied.students.length > 0) {
          setStudents(applied.students);
        }
        if (parcelsRef.current.length === 0 && applied.parcels.length > 0) {
          setParcels(applied.parcels);
        }
      }
    };

    try {
      await initializeDefaultCloudDataIfEmpty(AUTO_CLOUD_OWNER_ID);
      const data = await fetchCloudDataDirectly(AUTO_CLOUD_OWNER_ID, firebaseAuthUser?.uid);
      if (data.quotaExceeded) {
        handleQuotaExceeded();
        await applyStudentBackupFallback('quota_exceeded');
        return { success: false, quotaExceeded: true };
      }
      if (data.connectionFailed) {
        await applyStudentBackupFallback('offline_fallback');
        showToast(
          `ไม่สามารถเชื่อมต่อ Firestore ได้ ระบบกำลังใช้ข้อมูลจากฐานข้อมูลสำรอง (นักเรียน ${studentsRef.current.length} คน · พัสดุ ${parcelsRef.current.length} ชิ้น)`,
          'warning'
        );
        return { success: false, connectionFailed: true };
      }

      setQuotaExceeded(false);
      setFirestoreConnectionStatus('connected');

      // รักษารายละเอียด attribution ที่บันทึกไว้ในฐานข้อมูลสำรองของเครื่อง/เซิร์ฟเวอร์ (เช่น recordedByName)
      const localAttrMap = new Map<string, Parcel>();
      for (const lp of parcelsRef.current) {
        localAttrMap.set(lp.id || lp.trackingNumber, lp);
      }
      const enrichedCloudParcels = data.parcels.map((cp) => {
        const key = cp.id || cp.trackingNumber;
        const localP = localAttrMap.get(key);
        if (localP?.recordedByMemberId || localP?.recordedByName) {
          return {
            ...cp,
            recordedByMemberId: localP.recordedByMemberId,
            recordedByName: localP.recordedByName,
            recordedByRole: localP.recordedByRole,
          };
        }
        return cp;
      });

      const applied = applyPendingItemsToSnapshot(
        {
          students: data.students,
          parcels: enrichedCloudParcels,
          members: data.members.length > 0 ? data.members : INITIAL_MEMBERS,
          rolePermissions:
            data.rolePermissions.length > 0 ? data.rolePermissions : INITIAL_ROLE_PERMISSIONS,
          rateLimitConfig: data.rateLimitConfig || rateLimitRef.current,
        },
        pendingWritesRef.current
      );

      setStudents(applied.students);
      setParcels(applied.parcels);
      setMembers(applied.members);
      setRolePermissions(applied.rolePermissions);
      setParcelRateLimitConfig(applied.rateLimitConfig);
      try {
        localStorage.setItem('spms_rate_limit_config_v1', JSON.stringify(applied.rateLimitConfig));
      } catch {
        // ignore
      }

      const nowIso = new Date().toISOString();
      await saveLocalSearchCache({
        students: applied.students,
        parcels: applied.parcels,
        members: applied.members,
        rolePermissions: applied.rolePermissions,
        rateLimitConfig: applied.rateLimitConfig,
        lastSyncedAt: nowIso,
        lastAutoUploadDate: localBackupStatusRef.current.lastAutoUploadDate,
        lastUploadedAt: localBackupStatusRef.current.lastUploadedAt,
      });

      const [backupSaved, parcelBackupSaved] = await Promise.all([
        saveAllStudentsToBackupDb(applied.students, 'firestore_sync'),
        saveAllParcelsToBackupDb(applied.parcels, 'firestore_sync'),
      ]);
      setStudentBackupStatus({
        count: backupSaved.count,
        updatedAt: backupSaved.updatedAt,
        filePath: backupSaved.filePath,
        serverFileActive: backupSaved.serverFileActive,
        indexedDbActive: backupSaved.indexedDbActive,
        source: backupSaved.source,
      });
      setParcelBackupStatus({
        count: parcelBackupSaved.count,
        updatedAt: parcelBackupSaved.updatedAt,
        filePath: parcelBackupSaved.filePath,
        serverFileActive: parcelBackupSaved.serverFileActive,
        indexedDbActive: parcelBackupSaved.indexedDbActive,
        source: parcelBackupSaved.source,
      });

      setQuotaMetrics((prev) => ({
        ...prev,
        firestoreReadsUsed: prev.firestoreReadsUsed + data.readsCount,
        lastSyncedAt: nowIso,
      }));
      return { success: true };
    } catch (err) {
      if (isFirestoreQuotaError(err)) {
        handleQuotaExceeded();
        await applyStudentBackupFallback('quota_exceeded');
        return { success: false, quotaExceeded: true };
      }
      await applyStudentBackupFallback('offline_fallback');
      showToast(
        `ไม่สามารถเชื่อมต่อ Firestore ได้ ระบบกำลังใช้ข้อมูลจากฐานข้อมูลสำรอง (${studentsRef.current.length} คน)`,
        'warning'
      );
      return { success: false, connectionFailed: true };
    } finally {
      setIsSyncing(false);
    }
  }, [firebaseAuthUser?.uid, handleQuotaExceeded, applyPendingItemsToSnapshot, showToast]);

  // อัปโหลดข้อมูลทั้งหมดในไฟล์สำรองขึ้น Firebase แล้วลบรายการที่อัปโหลดออกจากไฟล์สำรองรออัพโหลด
  const uploadStagedToFirebase = useCallback(
    async (options?: { isAutoMidnight?: boolean }) => {
      const itemsToUpload = [...pendingWritesRef.current];
      if (itemsToUpload.length === 0) {
        if (!options?.isAutoMidnight) {
          showToast('ไม่มีข้อมูลค้างอัปโหลดในไฟล์สำรองระบบ', 'info');
        }
        return;
      }
      if (isUploadingRef.current) return;
      isUploadingRef.current = true;
      setIsSyncing(true);
      setSyncProgress({ completed: 0, total: itemsToUpload.length });

      try {
        const result = await uploadPendingWritesBatchToFirestore(
          itemsToUpload,
          AUTO_CLOUD_OWNER_ID,
          (completed, total) => setSyncProgress({ completed, total })
        );

        if (result.quotaExceeded) {
          handleQuotaExceeded(!options?.isAutoMidnight);
          lastQuotaProbeTimeRef.current = Date.now();
          setLastQuotaCheckAt(new Date().toISOString());
          return;
        }

        if (result.connectionFailed) {
          setFirestoreConnectionStatus('offline_fallback');
          firestoreConnectionStatusRef.current = 'offline_fallback';
          setLastWriteMode('local_storage_offline');
          showToast(
            'ไม่สามารถเชื่อมต่อ Firestore ได้ ข้อมูลยังคงปลอดภัยอยู่ใน localStorage และฐานข้อมูลสำรองในระบบ',
            'warning'
          );
          return;
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const todayYMD = getLocalTodayYMD(now);
        const uploadedKeys = itemsToUpload.map((item) => `${item.collection}:${item.docId}`);

        // อัปโหลดสำเร็จ -> ลบเฉพาะรายการที่อัปโหลดแล้วออกจากคิว localStorage / ไฟล์สำรองรออัพโหลด
        const clearRes = await clearStagedBackupAfterUpload({
          lastAutoUploadDate: todayYMD,
          lastUploadedAt: nowIso,
          uploadedKeys,
        });

        const remainingPending = clearRes.remainingPending || [];
        pendingWritesRef.current = remainingPending;
        setPendingWrites(remainingPending);
        setQuotaExceeded(false);
        quotaExceededRef.current = false;
        hasShownQuotaNoticeRef.current = false;
        setFirestoreConnectionStatus('connected');
        firestoreConnectionStatusRef.current = 'connected';
        setLastWriteMode('firestore_direct');
        lastQuotaProbeTimeRef.current = Date.now();
        setLastQuotaCheckAt(nowIso);
        setLocalBackupStatus((prev) => ({
          ...prev,
          serverFileActive: clearRes.serverFileActive,
          stagingFileExists: remainingPending.length > 0,
          stagedCount: remainingPending.length,
          lastAutoUploadDate: todayYMD,
          lastUploadedAt: nowIso,
          nextScheduledUploadAt: getNextMidnightScheduleInfo(now).isoString,
        }));

        setQuotaMetrics((prev) => ({
          ...prev,
          batchedWritesQueued: remainingPending.length,
          firestoreWritesUsed: prev.firestoreWritesUsed + result.uploadedCount,
          lastSyncedAt: nowIso,
        }));

        showToast(
          options?.isAutoMidnight
            ? `อัปโหลดข้อมูลอัตโนมัติ (00.00 น.) เข้า Firestore สำเร็จ ${result.uploadedCount} รายการ และล้างคิว localStorage เรียบร้อยแล้ว`
            : `อัปโหลดข้อมูลจาก localStorage เข้า Firestore สำเร็จ ${result.uploadedCount} รายการ และล้างคิวรอส่งเรียบร้อยแล้ว`,
          'success'
        );
      } catch (err) {
        if (isFirestoreQuotaError(err)) {
          handleQuotaExceeded(!options?.isAutoMidnight);
          lastQuotaProbeTimeRef.current = Date.now();
          setLastQuotaCheckAt(new Date().toISOString());
        } else {
          setFirestoreConnectionStatus('offline_fallback');
          firestoreConnectionStatusRef.current = 'offline_fallback';
          setLastWriteMode('local_storage_offline');
          showToast(
            `เกิดข้อผิดพลาดระหว่างอัปโหลดขึ้น Firebase (ข้อมูลใน localStorage ยังคงอยู่): ${
              err instanceof Error ? err.message : 'Error'
            }`,
            'error'
          );
        }
      } finally {
        isUploadingRef.current = false;
        setIsSyncing(false);
        setSyncProgress(null);
      }
    },
    [handleQuotaExceeded, showToast]
  );

  // เริ่มต้นระบบแบบ Local-First: โหลดจากฐานข้อมูลสำรองนักเรียนและไฟล์แคชในระบบก่อน เพื่อทำงานได้แม้เชื่อมต่อ Firestore ไม่ได้
  useEffect(() => {
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    const bootstrapFromLocalFirst = async () => {
      const store = await loadLocalBackupStore();
      const cachedStudents =
        store.cache?.students && store.cache.students.length > 0
          ? store.cache.students
          : store.studentsBackup.students;

      const cachedParcels =
        store.parcelsBackup?.parcels && store.parcelsBackup.parcels.length > 0
          ? store.parcelsBackup.parcels
          : store.cache?.parcels || [];

      const hasCachedData =
        cachedStudents.length > 0 || cachedParcels.length > 0;

      const baseSnapshot = {
        students: cachedStudents,
        parcels: cachedParcels,
        members:
          store.cache?.members && store.cache.members.length > 0
            ? store.cache.members
            : INITIAL_MEMBERS,
        rolePermissions:
          store.cache?.rolePermissions && store.cache.rolePermissions.length > 0
            ? store.cache.rolePermissions
            : INITIAL_ROLE_PERMISSIONS,
        rateLimitConfig: store.cache?.rateLimitConfig || rateLimitRef.current,
      };

      const applied = applyPendingItemsToSnapshot(baseSnapshot, store.pendingWrites);
      setStudents(applied.students);
      setParcels(applied.parcels);
      setMembers(applied.members);
      setRolePermissions(applied.rolePermissions);
      setParcelRateLimitConfig(applied.rateLimitConfig);

      pendingWritesRef.current = store.pendingWrites;
      setPendingWrites(store.pendingWrites);

      setLocalBackupStatus({
        serverFileActive: store.serverFileActive,
        stagingFileExists: store.stagingFileExists,
        stagingFilePath: store.stagingFilePath,
        cacheFilePath: store.cacheFilePath,
        stagedCount: store.pendingWrites.length,
        lastAutoUploadDate: store.cache?.lastAutoUploadDate || null,
        lastUploadedAt: store.cache?.lastUploadedAt || null,
        nextScheduledUploadAt: getNextMidnightScheduleInfo().isoString,
      });

      setStudentBackupStatus({
        count: applied.students.length,
        updatedAt: store.studentsBackup.updatedAt,
        filePath: store.studentsBackup.filePath,
        serverFileActive: store.studentsBackup.serverFileActive,
        indexedDbActive: store.studentsBackup.indexedDbActive,
        source: store.studentsBackup.source,
      });

      setParcelBackupStatus({
        count: applied.parcels.length,
        updatedAt: store.parcelsBackup.updatedAt,
        filePath: store.parcelsBackup.filePath,
        serverFileActive: store.parcelsBackup.serverFileActive,
        indexedDbActive: store.parcelsBackup.indexedDbActive,
        source: store.parcelsBackup.source,
      });

      setQuotaMetrics((prev) => ({
        ...prev,
        batchedWritesQueued: store.pendingWrites.length,
        lastSyncedAt: store.cache?.lastSyncedAt || prev.lastSyncedAt,
      }));

      // หากไม่มีข้อมูลสำรองในเครื่องเลย (เปิดใช้งานครั้งแรก) จึงดึงจาก Firebase 1 ครั้งแล้วบันทึกลงฐานข้อมูลสำรอง
      if (!hasCachedData && store.pendingWrites.length === 0) {
        await loadDataDirectlyFromFirestore();
        return;
      }

      // หากมีข้อมูลค้างอัปโหลดจากวันก่อนหน้า (เลยเวลา 00.00 น. มาแล้ว) ให้อัปโหลดอัตโนมัติทันที (หากโควตาเต็มจะแจ้งเตือนและเก็บไว้ใน localStorage ต่อ)
      const todayYMD = getLocalTodayYMD();
      const hasOverdueStaged = store.pendingWrites.some(
        (item) => getLocalTodayYMD(new Date(item.queuedAt)) < todayYMD
      );
      if (
        store.pendingWrites.length > 0 &&
        hasOverdueStaged &&
        store.cache?.lastAutoUploadDate !== todayYMD
      ) {
        await uploadStagedToFirebase({ isAutoMidnight: true });
      }
    };

    bootstrapFromLocalFirst();
  }, [applyPendingItemsToSnapshot, loadDataDirectlyFromFirestore, uploadStagedToFirebase]);

  // รีเฟรชยอดรวมพัสดุและคิวรออัปโหลดจากฐานข้อมูลสำรองกลางของเซิร์ฟเวอร์ (เพื่อรวมยอดทุก User ที่ใช้งานพร้อมกัน)
  const refreshFromLocalBackupServer = useCallback(async (): Promise<void> => {
    try {
      const store = await loadLocalBackupStore();
      if (!store.serverFileActive) return;

      const serverParcels =
        store.parcelsBackup.parcels.length > 0
          ? store.parcelsBackup.parcels
          : store.cache?.parcels || [];

      const applied = applyPendingItemsToSnapshot(
        {
          students:
            store.cache?.students && store.cache.students.length > 0
              ? store.cache.students
              : studentsRef.current,
          parcels: serverParcels,
          members:
            store.cache?.members && store.cache.members.length > 0
              ? store.cache.members
              : membersRef.current,
          rolePermissions:
            store.cache?.rolePermissions && store.cache.rolePermissions.length > 0
              ? store.cache.rolePermissions
              : rolePermissionsRef.current,
          rateLimitConfig: store.cache?.rateLimitConfig || rateLimitRef.current,
        },
        store.pendingWrites
      );

      setParcels(applied.parcels);
      pendingWritesRef.current = store.pendingWrites;
      setPendingWrites(store.pendingWrites);
      setLocalBackupStatus((prev) => ({
        ...prev,
        serverFileActive: store.serverFileActive,
        stagingFileExists: store.stagingFileExists,
        stagedCount: store.pendingWrites.length,
        lastAutoUploadDate: store.cache?.lastAutoUploadDate || prev.lastAutoUploadDate,
        lastUploadedAt: store.cache?.lastUploadedAt || prev.lastUploadedAt,
      }));
      setParcelBackupStatus({
        count: applied.parcels.length,
        updatedAt: store.parcelsBackup.updatedAt,
        filePath: store.parcelsBackup.filePath,
        serverFileActive: store.parcelsBackup.serverFileActive,
        indexedDbActive: store.parcelsBackup.indexedDbActive,
        source: store.parcelsBackup.source,
      });
      setQuotaMetrics((prev) => ({
        ...prev,
        batchedWritesQueued: store.pendingWrites.length,
      }));
    } catch {
      // ignore background refresh failures
    }
  }, [applyPendingItemsToSnapshot]);

  useEffect(() => {
    const onFocus = () => {
      void refreshFromLocalBackupServer();
    };
    window.addEventListener('focus', onFocus);
    const interval = setInterval(() => {
      void refreshFromLocalBackupServer();
    }, 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [refreshFromLocalBackupServer]);

  useEffect(() => {
    if (hasBootstrappedRef.current && currentMemberId) {
      void refreshFromLocalBackupServer();
    }
  }, [currentMemberId, refreshFromLocalBackupServer]);

  // ตั้งเวลาอัปโหลดอัตโนมัติทุกวันเวลา 00.00 น. ของทุกวัน และลบไฟล์สำรองในระบบหลังอัปโหลดสำเร็จ
  useEffect(() => {
    let midnightTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextMidnight = () => {
      const info = getNextMidnightScheduleInfo();
      setLocalBackupStatus((prev) => ({
        ...prev,
        nextScheduledUploadAt: info.isoString,
      }));

      // จำกัด setTimeout ไม่เกิน 24 วัน (ป้องกัน 32-bit overflow) ซึ่งเที่ยงคืนถัดไป < 24 ชม. เสมอ
      midnightTimeout = setTimeout(() => {
        if (pendingWritesRef.current.length > 0) {
          void uploadStagedToFirebase({ isAutoMidnight: true });
        }
        scheduleNextMidnight();
      }, info.msUntilMidnight + 500);
    };

    scheduleNextMidnight();

    // ตรวจสอบซ้ำทุก 30 วินาที เผื่อกรณีเครื่องสลีปข้ามเที่ยงคืน
    const checkInterval = setInterval(() => {
      const now = new Date();
      const todayYMD = getLocalTodayYMD(now);
      const isMidnightWindow = now.getHours() === 0 && now.getMinutes() <= 2;
      const hasOverdue = pendingWritesRef.current.some(
        (item) => getLocalTodayYMD(new Date(item.queuedAt)) < todayYMD
      );

      if (
        pendingWritesRef.current.length > 0 &&
        localBackupStatusRef.current.lastAutoUploadDate !== todayYMD &&
        (isMidnightWindow || hasOverdue)
      ) {
        void uploadStagedToFirebase({ isAutoMidnight: true });
      }
    }, 30000);

    return () => {
      if (midnightTimeout) clearTimeout(midnightTimeout);
      clearInterval(checkInterval);
    };
  }, [uploadStagedToFirebase]);

  // In-Memory Hash Map สำหรับค้นหาข้อมูลนักเรียนทันที (รองรับทั้งรหัสเดิมและรหัสเติม 0 ครบ 5 หลัก)
  const studentMap = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of students) {
      const code = s.studentCode.trim().toLowerCase();
      map.set(code, s);
      const formatted = formatStudentCode(code).toLowerCase();
      if (formatted !== code) {
        map.set(formatted, s);
      }
    }
    return map;
  }, [students]);

  // คำนวณสถิติพัสดุของนักเรียน
  const {
    byStudentCode: studentParcelStatsMap,
    allStats: allStudentParcelStats,
    overWeeklyLimitList: overWeeklyLimitStudents,
    overLimitList: overLimitStudents,
  } = useMemo(
    () => buildAllStudentParcelStats(students, parcels, parcelRateLimitConfig),
    [students, parcels, parcelRateLimitConfig]
  );

  const updateParcelRateLimitConfig = useCallback(
    async (newConfig: ParcelRateLimitConfig): Promise<void> => {
      setParcelRateLimitConfig(newConfig);
      try {
        localStorage.setItem('spms_rate_limit_config_v1', JSON.stringify(newConfig));
      } catch {
        // ignore
      }
      const item: PendingWriteItem = {
        id: `system_settings:parcel_rate_limits:${Date.now()}`,
        collection: 'system_settings',
        docId: 'parcel_rate_limits',
        action: 'upsert',
        data: newConfig,
        queuedAt: new Date().toISOString(),
      };
      const writeRes = await commitWritesDirectOrFallbackToLocalStorage([item], {
        rateLimitConfig: newConfig,
      });
      showToast(
        writeRes.mode === 'firestore_direct'
          ? 'บันทึกการตั้งค่าอัตราการสั่งพัสดุลงฐานข้อมูล Firestore โดยตรงสำเร็จ'
          : 'โควตา Firestore เต็ม/ออฟไลน์ — บันทึกการตั้งค่าอัตราการสั่งพัสดุลง localStorage แล้ว',
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );
    },
    [commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  const getStudentParcelCounts = useCallback(
    (
      studentCode?: string,
      studentFullName?: string,
      studentMeta?: Partial<Student>
    ): StudentParcelCountStats => {
      const cleanCode = (studentCode || '').trim().toLowerCase();
      if (cleanCode && cleanCode !== 'unknown' && cleanCode !== '-') {
        const cached =
          studentParcelStatsMap.get(cleanCode) ||
          studentParcelStatsMap.get(formatStudentCode(cleanCode).toLowerCase());
        if (cached) return cached;
      }
      return getStudentParcelCountStats(
        parcels,
        studentCode,
        studentFullName,
        studentMeta,
        parcelRateLimitConfig
      );
    },
    [parcels, studentParcelStatsMap, parcelRateLimitConfig]
  );

  const openWeeklyWarningPopup = useCallback(
    (
      focusedStudent?: StudentParcelCountStats | null,
      reason: WeeklyWarningPopupState['triggerReason'] = 'manual',
      customMessage?: string,
      customReasons?: string[]
    ) => {
      setWeeklyWarningPopup({
        isOpen: true,
        focusedStudent: focusedStudent || null,
        triggerReason: reason,
        customWarningMessage: customMessage,
        exceededReasons: customReasons || focusedStudent?.exceededReasons || [],
      });
    },
    []
  );

  const closeWeeklyWarningPopup = useCallback(() => {
    setWeeklyWarningPopup((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const lookupStudentByCode = useCallback(
    (code: string): Student | undefined => {
      const clean = code.trim().toLowerCase();
      if (!clean) return undefined;
      const formatted = formatStudentCode(clean).toLowerCase();
      return studentMap.get(clean) || studentMap.get(formatted);
    },
    [studentMap]
  );

  const searchStudentsLocal = useCallback(
    (keyword: string): Student[] => {
      const clean = keyword.trim().toLowerCase();
      if (!clean) return students;
      const formatted = formatStudentCode(clean).toLowerCase();
      return students.filter(
        (s) =>
          s.studentCode.toLowerCase().includes(clean) ||
          (formatted !== clean && s.studentCode.toLowerCase().includes(formatted)) ||
          s.firstName.toLowerCase().includes(clean) ||
          s.lastName.toLowerCase().includes(clean) ||
          s.nickname.toLowerCase().includes(clean) ||
          s.dormitory.toLowerCase().includes(clean) ||
          s.dormRoom.toLowerCase().includes(clean) ||
          s.grade.toLowerCase().includes(clean) ||
          s.room.toLowerCase().includes(clean)
      );
    },
    [students]
  );

  const searchParcelsLocal = useCallback(
    (keyword: string, statusFilter = 'ALL', dormFilter = 'ALL', dateFilter = 'ALL'): Parcel[] => {
      const clean = keyword.trim().toLowerCase();
      const formatted = formatStudentCode(clean).toLowerCase();
      return parcels.filter((p) => {
        if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
        if (dormFilter !== 'ALL' && p.dormitory !== dormFilter) return false;
        if (dateFilter !== 'ALL' && p.receivedDate !== dateFilter) return false;
        if (!clean) return true;
        return (
          p.trackingNumber.toLowerCase().includes(clean) ||
          p.studentCode.toLowerCase().includes(clean) ||
          (formatted !== clean && p.studentCode.toLowerCase().includes(formatted)) ||
          p.studentFullName.toLowerCase().includes(clean) ||
          p.nickname.toLowerCase().includes(clean) ||
          p.dormitory.toLowerCase().includes(clean) ||
          p.dormRoom.toLowerCase().includes(clean) ||
          p.bed.toLowerCase().includes(clean) ||
          p.courier.toLowerCase().includes(clean) ||
          p.category.toLowerCase().includes(clean) ||
          p.note.toLowerCase().includes(clean)
        );
      });
    },
    [parcels]
  );

  const recordLocalSearchSaving = useCallback(() => {
    setQuotaMetrics((prev) => ({
      ...prev,
      localLookupsSaved: prev.localLookupsSaved + 1,
    }));
  }, []);

  /**
   * ค้นหานักเรียนจากข้อมูลสำรองในระบบก่อน หากไม่พบจึงค้นหาใน Firebase (ลด Quota การอ่าน)
   */
  const lookupStudentWithCloudFallback = useCallback(
    async (
      code: string
    ): Promise<{ student: Student | undefined; source: 'local' | 'firebase' | 'none' }> => {
      const localMatch = lookupStudentByCode(code);
      if (localMatch) {
        recordLocalSearchSaving();
        return { student: localMatch, source: 'local' };
      }

      const clean = code.trim();
      if (!clean || quotaExceeded) {
        return { student: undefined, source: 'none' };
      }

      const fallbackRes = await findStudentInFirestoreFallback(clean);
      if (fallbackRes.quotaExceeded) {
        handleQuotaExceeded();
        return { student: undefined, source: 'none' };
      }

      if (fallbackRes.readsCount > 0) {
        setQuotaMetrics((prev) => ({
          ...prev,
          firestoreReadsUsed: prev.firestoreReadsUsed + fallbackRes.readsCount,
        }));
      }

      if (fallbackRes.student) {
        const foundStudent = fallbackRes.student;
        const nextStudents = [
          foundStudent,
          ...studentsRef.current.filter((s) => s.studentCode !== foundStudent.studentCode),
        ].sort((a, b) => a.seqNo - b.seqNo);
        setStudents(nextStudents);
        await saveLocalSearchCache({ students: nextStudents });
        return { student: foundStudent, source: 'firebase' };
      }

      return { student: undefined, source: 'none' };
    },
    [lookupStudentByCode, recordLocalSearchSaving, quotaExceeded, handleQuotaExceeded]
  );

  /**
   * ค้นหาพัสดุจากข้อมูลสำรองในระบบก่อน หากไม่พบจึงค้นหาใน Firebase (ลด Quota การอ่าน)
   */
  const searchParcelsWithCloudFallback = useCallback(
    async (
      keyword: string,
      statusFilter = 'ALL',
      dormFilter = 'ALL',
      dateFilter = 'ALL'
    ): Promise<{ parcels: Parcel[]; source: 'local' | 'firebase' }> => {
      const localResults = searchParcelsLocal(keyword, statusFilter, dormFilter, dateFilter);
      if (localResults.length > 0) {
        recordLocalSearchSaving();
        return { parcels: localResults, source: 'local' };
      }

      const clean = keyword.trim();
      if (clean.length < 4 || quotaExceeded) {
        return { parcels: [], source: 'local' };
      }

      const fallbackRes = await findParcelInFirestoreFallback(clean, AUTO_CLOUD_OWNER_ID);
      if (fallbackRes.quotaExceeded) {
        handleQuotaExceeded();
        return { parcels: [], source: 'local' };
      }

      if (fallbackRes.readsCount > 0) {
        setQuotaMetrics((prev) => ({
          ...prev,
          firestoreReadsUsed: prev.firestoreReadsUsed + fallbackRes.readsCount,
        }));
      }

      if (fallbackRes.parcels.length > 0) {
        const existingMap = new Map<string, Parcel>();
        for (const p of parcelsRef.current) {
          existingMap.set(p.id || p.trackingNumber, p);
        }
        for (const fp of fallbackRes.parcels) {
          existingMap.set(fp.id || fp.trackingNumber, fp);
        }
        const mergedParcels = Array.from(existingMap.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setParcels(mergedParcels);
        await saveLocalSearchCache({ parcels: mergedParcels });

        const filteredCloud = fallbackRes.parcels.filter((p) => {
          if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
          if (dormFilter !== 'ALL' && p.dormitory !== dormFilter) return false;
          if (dateFilter !== 'ALL' && p.receivedDate !== dateFilter) return false;
          return true;
        });
        return { parcels: filteredCloud, source: 'firebase' };
      }

      return { parcels: [], source: 'firebase' };
    },
    [searchParcelsLocal, recordLocalSearchSaving, quotaExceeded, handleQuotaExceeded]
  );

  // -----------------------------------------------------------------
  // การดำเนินการ บันทึก / แก้ไข / ลบ ลงไฟล์สำรองในระบบก่อน แล้วอัปโหลดขึ้น Firebase เวลา 00.00 น.
  // -----------------------------------------------------------------

  /**
   * บันทึกรับเข้าพัสดุใหม่ลงไฟล์สำรองของระบบก่อน (รออัปโหลดขึ้น Firebase เวลา 00.00 น.)
   */
  const addInboundParcel = useCallback(
    async (input: NewParcelInput): Promise<Parcel & { writeMode?: WriteTargetMode }> => {
      const trackingNumber = input.trackingNumber.trim();
      const rawCode = input.studentCode.trim();
      const studentCode = formatStudentCode(rawCode);
      const matchedStudent = lookupStudentByCode(studentCode) || lookupStudentByCode(rawCode);
      const isUnknown = input.status === 'พัสดุไม่ทราบเจ้าของ';

      const studentFullName = isUnknown
        ? 'ไม่ทราบชื่อผู้รับ'
        : input.customStudent?.studentFullName ||
          (matchedStudent
            ? `${matchedStudent.prefix}${matchedStudent.firstName} ${matchedStudent.lastName}`
            : 'ไม่ระบุชื่อ');

      const nickname = isUnknown
        ? ''
        : input.customStudent?.nickname || matchedStudent?.nickname || '';
      const gradeRoom = isUnknown
        ? '-'
        : input.customStudent?.gradeRoom ||
          (matchedStudent ? `${matchedStudent.grade}/${matchedStudent.room}` : '-');
      const dormitory = isUnknown
        ? 'ส่วนกลาง (รอระบุหอ)'
        : input.customStudent?.dormitory || matchedStudent?.dormitory || 'ไม่ระบุหอ';
      const dormRoom = isUnknown
        ? '-'
        : input.customStudent?.dormRoom || matchedStudent?.dormRoom || '-';
      const bed = isUnknown
        ? '-'
        : input.customStudent?.bed || matchedStudent?.bed || '-';

      const now = new Date();
      const isoNow = now.toISOString();
      const actor = getCurrentActorAttribution();

      const newParcel: Parcel = {
        id: trackingNumber,
        trackingNumber,
        studentCode: isUnknown ? 'UNKNOWN' : formatStudentCode(studentCode) || 'UNKNOWN',
        studentFullName,
        nickname,
        gradeRoom,
        dormitory,
        dormRoom,
        bed,
        category: input.category,
        status: input.status,
        courier: input.courier,
        note: input.note.trim(),
        isSixDigitsInput:
          input.isSixDigitsInput !== undefined
            ? input.isSixDigitsInput
            : isSixDigitsTrackingNumber(trackingNumber),
        receivedDate: getRelativeDateString(0),
        receivedHour: now.getHours(),
        ownerId: AUTO_CLOUD_OWNER_ID,
        recordedByMemberId: actor.memberId,
        recordedByName: actor.name,
        recordedByRole: actor.role,
        createdAt: isoNow,
        updatedAt: isoNow,
      };

      const nextParcels = [
        newParcel,
        ...parcelsRef.current.filter((p) => (p.id || p.trackingNumber) !== trackingNumber),
      ];
      setParcels(nextParcels);

      const stagedItem: PendingWriteItem = {
        id: `parcels:${trackingNumber}:${Date.now()}`,
        collection: 'parcels',
        docId: trackingNumber,
        action: 'upsert',
        data: newParcel,
        queuedAt: isoNow,
        queuedByMemberId: actor.memberId,
        queuedByName: actor.name,
        queuedByRole: actor.role,
      };
      const writeRes = await commitWritesDirectOrFallbackToLocalStorage([stagedItem], {
        parcels: nextParcels,
      });
      if (writeRes.mode === 'firestore_direct') {
        showToast(
          `บันทึกพัสดุ ${newParcel.trackingNumber} ลงฐานข้อมูล Firestore โดยตรงสำเร็จ`,
          'success'
        );
      } else {
        showToast(
          `Quota Firestore เต็ม — บันทึกพัสดุ ${newParcel.trackingNumber} ลง localStorage สำเร็จ (พร้อมส่งออกหรืออัปโหลดเข้า Firestore)`,
          'warning'
        );
      }

      if (!isUnknownOwnerParcel(newParcel)) {
        const stats = getStudentParcelCountStats(
          nextParcels,
          newParcel.studentCode,
          newParcel.studentFullName,
          matchedStudent,
          parcelRateLimitConfig
        );
        if (stats.isOverLimit) {
          openWeeklyWarningPopup(stats, 'inbound_added');
        }
      }

      return { ...newParcel, writeMode: writeRes.mode };
    },
    [
      lookupStudentByCode,
      getCurrentActorAttribution,
      commitWritesDirectOrFallbackToLocalStorage,
      openWeeklyWarningPopup,
      showToast,
      parcelRateLimitConfig,
    ]
  );

  /**
   * อัปเดตสถานะพัสดุลงไฟล์สำรองในระบบก่อน (รออัปโหลดขึ้น Firebase เวลา 00.00 น.)
   */
  const updateParcelStatus = useCallback(
    async (
      parcelId: string,
      newStatus: ParcelStatus,
      note?: string,
      deliveredDate?: string
    ): Promise<void> => {
      const effectiveDeliveredDate =
        newStatus === 'ส่งมอบสำเร็จ'
          ? (deliveredDate || getRelativeDateString(0)).slice(0, 20)
          : '';
      const isoNow = new Date().toISOString();
      const actor = getCurrentActorAttribution();

      let updatedTarget: Parcel | null = null;
      const nextParcels = parcelsRef.current.map((p) => {
        if ((p.id || p.trackingNumber) === parcelId) {
          updatedTarget = {
            ...p,
            status: newStatus,
            ...(note !== undefined ? { note: note.slice(0, 300) } : {}),
            deliveredDate: effectiveDeliveredDate,
            recordedByMemberId: p.recordedByMemberId || actor.memberId,
            recordedByName: p.recordedByName || actor.name,
            recordedByRole: p.recordedByRole || actor.role,
            updatedAt: isoNow,
          };
          return updatedTarget;
        }
        return p;
      });

      if (!updatedTarget) return;
      setParcels(nextParcels);

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        [
          {
            id: `parcels:${parcelId}:${Date.now()}`,
            collection: 'parcels',
            docId: parcelId,
            action: 'upsert',
            data: updatedTarget,
            queuedAt: isoNow,
            queuedByMemberId: actor.memberId,
            queuedByName: actor.name,
            queuedByRole: actor.role,
          },
        ],
        { parcels: nextParcels }
      );

      showToast(
        writeRes.mode === 'firestore_direct'
          ? `อัปเดตสถานะพัสดุ ${parcelId} เป็น "${newStatus}" ลงฐานข้อมูล Firestore โดยตรงสำเร็จ`
          : `Quota เต็ม — อัปเดตสถานะพัสดุ ${parcelId} เป็น "${newStatus}" ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );
    },
    [getCurrentActorAttribution, commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * แก้ไขรายละเอียดพัสดุลงไฟล์สำรองในระบบก่อน
   */
  const updateParcelDetails = useCallback(
    async (parcelId: string, updates: Partial<Parcel>): Promise<void> => {
      const isoNow = new Date().toISOString();
      const actor = getCurrentActorAttribution();
      let updatedTarget: Parcel | null = null;
      const nextParcels = parcelsRef.current.map((p) => {
        if ((p.id || p.trackingNumber) === parcelId) {
          updatedTarget = {
            ...p,
            ...updates,
            recordedByMemberId: updates.recordedByMemberId || p.recordedByMemberId || actor.memberId,
            recordedByName: updates.recordedByName || p.recordedByName || actor.name,
            recordedByRole: updates.recordedByRole || p.recordedByRole || actor.role,
            updatedAt: isoNow,
          };
          return updatedTarget;
        }
        return p;
      });

      if (!updatedTarget) return;
      setParcels(nextParcels);

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        [
          {
            id: `parcels:${parcelId}:${Date.now()}`,
            collection: 'parcels',
            docId: parcelId,
            action: 'upsert',
            data: updatedTarget,
            queuedAt: isoNow,
            queuedByMemberId: actor.memberId,
            queuedByName: actor.name,
            queuedByRole: actor.role,
          },
        ],
        { parcels: nextParcels }
      );

      showToast(
        writeRes.mode === 'firestore_direct'
          ? `บันทึกการแก้ไขข้อมูลพัสดุ ${parcelId} ลง Firestore โดยตรงสำเร็จ`
          : `Quota เต็ม — บันทึกการแก้ไขข้อมูลพัสดุ ${parcelId} ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );
    },
    [getCurrentActorAttribution, commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * อัปเดตสถานะพัสดุหลายรายการพร้อมกันลงไฟล์สำรองในระบบก่อน
   */
  const bulkUpdateParcelStatus = useCallback(
    async (
      parcelIds: string[],
      newStatus: ParcelStatus,
      deliveredDate?: string
    ): Promise<void> => {
      if (parcelIds.length === 0) return;
      const targetSet = new Set(parcelIds);
      const effectiveDeliveredDate =
        newStatus === 'ส่งมอบสำเร็จ'
          ? (deliveredDate || getRelativeDateString(0)).slice(0, 20)
          : '';
      const isoNow = new Date().toISOString();
      const actor = getCurrentActorAttribution();
      const stagedItems: PendingWriteItem[] = [];

      const nextParcels = parcelsRef.current.map((p) => {
        const key = p.id || p.trackingNumber;
        if (targetSet.has(key)) {
          const updated: Parcel = {
            ...p,
            status: newStatus,
            deliveredDate: effectiveDeliveredDate,
            recordedByMemberId: p.recordedByMemberId || actor.memberId,
            recordedByName: p.recordedByName || actor.name,
            recordedByRole: p.recordedByRole || actor.role,
            updatedAt: isoNow,
          };
          stagedItems.push({
            id: `parcels:${key}:${Date.now()}`,
            collection: 'parcels',
            docId: key,
            action: 'upsert',
            data: updated,
            queuedAt: isoNow,
            queuedByMemberId: actor.memberId,
            queuedByName: actor.name,
            queuedByRole: actor.role,
          });
          return updated;
        }
        return p;
      });

      setParcels(nextParcels);
      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(stagedItems, {
        parcels: nextParcels,
      });
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `อัปเดตพัสดุ ${stagedItems.length} รายการเป็น "${newStatus}" ลง Firestore โดยตรงสำเร็จ`
          : `Quota เต็ม — อัปเดตพัสดุ ${stagedItems.length} รายการเป็น "${newStatus}" ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );
    },
    [getCurrentActorAttribution, commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * ลบพัสดุออกจากแคชในระบบและพักคำสั่งลบลงไฟล์สำรองก่อนอัปโหลดขึ้น Firebase
   */
  const deleteParcel = useCallback(
    async (parcelId: string): Promise<void> => {
      const nextParcels = parcelsRef.current.filter(
        (p) => (p.id || p.trackingNumber) !== parcelId
      );
      setParcels(nextParcels);
      const actor = getCurrentActorAttribution();

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        [
          {
            id: `parcels:${parcelId}:${Date.now()}`,
            collection: 'parcels',
            docId: parcelId,
            action: 'delete',
            queuedAt: new Date().toISOString(),
            queuedByMemberId: actor.memberId,
            queuedByName: actor.name,
            queuedByRole: actor.role,
          },
        ],
        { parcels: nextParcels },
        { replaceCacheParcels: true }
      );

      showToast(
        writeRes.mode === 'firestore_direct'
          ? `ลบรายการพัสดุ ${parcelId} ออกจากฐานข้อมูล Firestore โดยตรงแล้ว`
          : `Quota เต็ม — บันทึกคำสั่งลบพัสดุ ${parcelId} ลง localStorage แล้ว (รออัปโหลดเข้า Firestore)`,
        writeRes.mode === 'firestore_direct' ? 'info' : 'warning'
      );
    },
    [getCurrentActorAttribution, commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * ลบพัสดุหลายรายการออกจากแคชและพักคำสั่งลบลงไฟล์สำรองก่อน
   */
  const bulkDeleteParcels = useCallback(
    async (parcelIds: string[], reasonLabel?: string): Promise<number> => {
      if (parcelIds.length === 0) return 0;
      const targetSet = new Set(parcelIds);
      const nextParcels = parcelsRef.current.filter(
        (p) => !targetSet.has(p.id || p.trackingNumber)
      );
      setParcels(nextParcels);

      const isoNow = new Date().toISOString();
      const actor = getCurrentActorAttribution();
      const stagedItems: PendingWriteItem[] = parcelIds.map((pid) => ({
        id: `parcels:${pid}:${Date.now()}`,
        collection: 'parcels',
        docId: pid,
        action: 'delete',
        queuedAt: isoNow,
        queuedByMemberId: actor.memberId,
        queuedByName: actor.name,
        queuedByRole: actor.role,
      }));

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        stagedItems,
        { parcels: nextParcels },
        { replaceCacheParcels: true }
      );
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `ลบข้อมูลพัสดุ${reasonLabel ? ` (${reasonLabel})` : ''} จำนวน ${parcelIds.length} ชิ้น ออกจาก Firestore โดยตรงแล้ว`
          : `Quota เต็ม — บันทึกคำสั่งลบพัสดุ${reasonLabel ? ` (${reasonLabel})` : ''} ${parcelIds.length} ชิ้น ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'info' : 'warning'
      );
      return parcelIds.length;
    },
    [getCurrentActorAttribution, commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * ลบพัสดุตามหอพักลงไฟล์สำรองก่อน
   */
  const bulkDeleteParcelsByDorm = useCallback(
    async (dormitory: string, statusFilter = 'ALL'): Promise<number> => {
      const normDorm = dormitory.trim();
      const targets = parcelsRef.current.filter((p) => {
        const dormMatch = p.dormitory.trim() === normDorm;
        if (!dormMatch) return false;
        if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
        return true;
      });

      if (targets.length === 0) {
        showToast(
          `ไม่พบรายการพัสดุของหอพัก "${normDorm}"${statusFilter !== 'ALL' ? ` ที่มีสถานะ "${statusFilter}"` : ''}`,
          'info'
        );
        return 0;
      }

      const ids = targets.map((p) => p.id || p.trackingNumber);
      const label = `หอพัก ${normDorm}${statusFilter !== 'ALL' ? ` [${statusFilter}]` : ''}`;
      return await bulkDeleteParcels(ids, label);
    },
    [bulkDeleteParcels, showToast]
  );

  /**
   * ล้างข้อมูลพัสดุทั้งหมดในแคชและพักคำสั่งลบลงไฟล์สำรอง
   */
  const clearAllParcels = useCallback(async (): Promise<number> => {
    const allIds = parcelsRef.current.map((p) => p.id || p.trackingNumber);
    if (allIds.length === 0) {
      showToast('ไม่มีรายการพัสดุในระบบ', 'info');
      return 0;
    }
    return await bulkDeleteParcels(allIds, 'ทั้งหมดในระบบ');
  }, [bulkDeleteParcels, showToast]);

  /**
   * นำเข้าหรือกู้คืนข้อมูลพัสดุจำนวนมากลงไฟล์สำรองระบบก่อน (รออัปโหลดขึ้น Firebase เวลา 00.00 น.)
   */
  const bulkImportParcels = useCallback(
    async (
      rawParcels: (Parcel | Omit<Parcel, 'createdAt' | 'updatedAt'>)[]
    ): Promise<number> => {
      if (rawParcels.length === 0) return 0;
      const isoNow = new Date().toISOString();
      const actor = getCurrentActorAttribution();
      const mergedMap = new Map<string, Parcel>();
      for (const p of parcelsRef.current) {
        mergedMap.set(p.id || p.trackingNumber, p);
      }

      const stagedItems: PendingWriteItem[] = [];
      for (const raw of rawParcels) {
        const id = (raw.trackingNumber || raw.id || '').trim();
        if (!id) continue;
        const rawWithAttr = raw as Parcel;
        const parcelObj: Parcel = {
          ...rawWithAttr,
          id,
          trackingNumber: id,
          ownerId: AUTO_CLOUD_OWNER_ID,
          recordedByMemberId: rawWithAttr.recordedByMemberId || actor.memberId,
          recordedByName: rawWithAttr.recordedByName || actor.name,
          recordedByRole: rawWithAttr.recordedByRole || actor.role,
          createdAt: rawWithAttr.createdAt || isoNow,
          updatedAt: isoNow,
        };
        mergedMap.set(id, parcelObj);
        stagedItems.push({
          id: `parcels:${id}:${Date.now()}`,
          collection: 'parcels',
          docId: id,
          action: 'upsert',
          data: parcelObj,
          queuedAt: isoNow,
          queuedByMemberId: actor.memberId,
          queuedByName: actor.name,
          queuedByRole: actor.role,
        });
      }

      const nextParcels = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setParcels(nextParcels);
      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(stagedItems, {
        parcels: nextParcels,
      });
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `นำเข้า/กู้คืนข้อมูลพัสดุ ${stagedItems.length} รายการ ลง Firestore โดยตรงสำเร็จ`
          : `Quota เต็ม — นำเข้าข้อมูลพัสดุ ${stagedItems.length} รายการ ลง localStorage แล้ว (พร้อมส่งออกหรืออัปโหลดเข้า Firestore)`,
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );
      return stagedItems.length;
    },
    [getCurrentActorAttribution, commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * กู้คืนข้อมูลสำรองทั้งระบบ (พักลงไฟล์สำรองระบบก่อนอัปโหลดขึ้น Firebase)
   */
  const fullRestoreSystemBackup = useCallback(
    async (
      backupData: { students?: Student[]; parcels?: Parcel[] },
      replaceAll = false
    ): Promise<{ studentsCount: number; parcelsCount: number }> => {
      const isoNow = new Date().toISOString();
      const stagedItems: PendingWriteItem[] = [];

      let nextStudents = replaceAll ? [] : [...studentsRef.current];
      let nextParcels = replaceAll ? [] : [...parcelsRef.current];

      if (replaceAll) {
        for (const p of parcelsRef.current) {
          const pid = p.id || p.trackingNumber;
          stagedItems.push({
            id: `parcels:${pid}:${Date.now()}`,
            collection: 'parcels',
            docId: pid,
            action: 'delete',
            queuedAt: isoNow,
          });
        }
        for (const s of studentsRef.current) {
          stagedItems.push({
            id: `students:${s.studentCode}:${Date.now()}`,
            collection: 'students',
            docId: s.studentCode,
            action: 'delete',
            queuedAt: isoNow,
          });
        }
      }

      let studentsCount = 0;
      let parcelsCount = 0;

      if (backupData.students && backupData.students.length > 0) {
        const sMap = new Map<string, Student>();
        for (const s of nextStudents) sMap.set(s.studentCode, s);
        for (const s of backupData.students) {
          const code = formatStudentCode(s.studentCode);
          const studentObj: Student = {
            ...s,
            studentCode: code,
            ownerId: AUTO_CLOUD_OWNER_ID,
            createdAt: s.createdAt || isoNow,
            updatedAt: isoNow,
          };
          sMap.set(code, studentObj);
          stagedItems.push({
            id: `students:${code}:${Date.now()}`,
            collection: 'students',
            docId: code,
            action: 'upsert',
            data: studentObj,
            queuedAt: isoNow,
          });
          studentsCount++;
        }
        nextStudents = Array.from(sMap.values()).sort((a, b) => a.seqNo - b.seqNo);
      }

      if (backupData.parcels && backupData.parcels.length > 0) {
        const pMap = new Map<string, Parcel>();
        const actor = getCurrentActorAttribution();
        for (const p of nextParcels) pMap.set(p.id || p.trackingNumber, p);
        for (const p of backupData.parcels) {
          const pid = (p.trackingNumber || p.id || '').trim();
          if (!pid) continue;
          const parcelObj: Parcel = {
            ...p,
            id: pid,
            trackingNumber: pid,
            ownerId: AUTO_CLOUD_OWNER_ID,
            recordedByMemberId: p.recordedByMemberId || actor.memberId,
            recordedByName: p.recordedByName || actor.name,
            recordedByRole: p.recordedByRole || actor.role,
            createdAt: p.createdAt || isoNow,
            updatedAt: isoNow,
          };
          pMap.set(pid, parcelObj);
          stagedItems.push({
            id: `parcels:${pid}:${Date.now()}`,
            collection: 'parcels',
            docId: pid,
            action: 'upsert',
            data: parcelObj,
            queuedAt: isoNow,
            queuedByMemberId: actor.memberId,
            queuedByName: actor.name,
            queuedByRole: actor.role,
          });
          parcelsCount++;
        }
        nextParcels = Array.from(pMap.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }

      setStudents(nextStudents);
      setParcels(nextParcels);
      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        stagedItems,
        {
          students: nextStudents,
          parcels: nextParcels,
        },
        { replaceCacheParcels: replaceAll }
      );

      showToast(
        writeRes.mode === 'firestore_direct'
          ? `กู้คืนข้อมูลลง Firestore โดยตรงสำเร็จ: นักเรียน ${studentsCount} คน, พัสดุ ${parcelsCount} รายการ`
          : `Quota เต็ม — กู้คืนข้อมูลลง localStorage สำเร็จ: นักเรียน ${studentsCount} คน, พัสดุ ${parcelsCount} รายการ (รออัปโหลดเข้า Firestore)`,
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );

      return { studentsCount, parcelsCount };
    },
    [getCurrentActorAttribution, commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * นำเข้าข้อมูลนักเรียนจำนวนมากลงฐานข้อมูลสำรอง (data/students-backup.json + IndexedDB)
   * และเลือกได้ว่าต้องการพักรออัปโหลดขึ้น Firebase เวลา 00.00 น. ด้วยหรือไม่
   */
  const bulkImportStudents = useCallback(
    async (
      rawStudents: Omit<Student, 'ownerId' | 'createdAt' | 'updatedAt'>[],
      stageForCloudSync: boolean = true
    ): Promise<number> => {
      if (rawStudents.length === 0) return 0;
      const isoNow = new Date().toISOString();
      const sMap = new Map<string, Student>();
      for (const s of studentsRef.current) sMap.set(s.studentCode, s);

      const stagedItems: PendingWriteItem[] = [];
      for (const s of rawStudents) {
        const code = formatStudentCode(s.studentCode);
        const studentObj: Student = {
          ...s,
          studentCode: code,
          ownerId: AUTO_CLOUD_OWNER_ID,
          createdAt: isoNow,
          updatedAt: isoNow,
        };
        sMap.set(code, studentObj);
        if (stageForCloudSync) {
          stagedItems.push({
            id: `students:${code}:${Date.now()}`,
            collection: 'students',
            docId: code,
            action: 'upsert',
            data: studentObj,
            queuedAt: isoNow,
          });
        }
      }

      const nextStudents = Array.from(sMap.values()).sort((a, b) => a.seqNo - b.seqNo);
      setStudents(nextStudents);

      const backupRes = await saveAllStudentsToBackupDb(
        nextStudents,
        stageForCloudSync ? 'bulk_import_and_stage' : 'backup_db_only'
      );
      await saveLocalSearchCache({ students: nextStudents });
      setStudentBackupStatus({
        count: backupRes.count,
        updatedAt: backupRes.updatedAt,
        filePath: backupRes.filePath,
        serverFileActive: backupRes.serverFileActive,
        indexedDbActive: backupRes.indexedDbActive,
        source: backupRes.source,
      });

      if (stageForCloudSync && stagedItems.length > 0) {
        const writeRes = await commitWritesDirectOrFallbackToLocalStorage(stagedItems, {
          students: nextStudents,
        });
        showToast(
          writeRes.mode === 'firestore_direct'
            ? `นำเข้ารายชื่อนักเรียน ${rawStudents.length} คน ลงฐานข้อมูล Firestore โดยตรงสำเร็จ (รวม ${nextStudents.length} คน)`
            : `Quota เต็ม — บันทึกรายชื่อนักเรียน ${rawStudents.length} คน ลง localStorage และฐานข้อมูลสำรองเรียบร้อยแล้ว`,
          writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
        );
      } else {
        showToast(
          `บันทึกรายชื่อนักเรียน ${rawStudents.length} คน ลงฐานข้อมูลสำรองในเครื่องเรียบร้อยแล้ว (รวมทั้งหมด ${nextStudents.length} คน)`,
          'success'
        );
      }
      return rawStudents.length;
    },
    [commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * บันทึกรายชื่อนักเรียนทั้งหมดที่มีอยู่ในระบบลงฐานข้อมูลสำรองทันที (data/students-backup.json + IndexedDB)
   */
  const backupAllStudentsNow = useCallback(async (): Promise<StudentBackupStatus> => {
    const res = await saveAllStudentsToBackupDb(studentsRef.current, 'manual_full_backup');
    await saveLocalSearchCache({ students: res.students });
    const nextStatus: StudentBackupStatus = {
      count: res.count,
      updatedAt: res.updatedAt,
      filePath: res.filePath,
      serverFileActive: res.serverFileActive,
      indexedDbActive: res.indexedDbActive,
      source: res.source,
    };
    setStudentBackupStatus(nextStatus);
    showToast(
      `บันทึกรายชื่อนักเรียนทั้งหมด ${res.count} คน ลงฐานข้อมูลสำรองเรียบร้อยแล้ว (${res.filePath})`,
      'success'
    );
    return nextStatus;
  }, [showToast]);

  /**
   * กู้คืนรายชื่อนักเรียนทั้งหมดจากฐานข้อมูลสำรองกรณีเชื่อมต่อ Firestore ไม่ได้
   */
  const restoreStudentsFromBackupDb = useCallback(async (): Promise<number> => {
    const backup = await loadAllStudentsFromBackupDb();
    setStudentBackupStatus({
      count: backup.count,
      updatedAt: backup.updatedAt,
      filePath: backup.filePath,
      serverFileActive: backup.serverFileActive,
      indexedDbActive: backup.indexedDbActive,
      source: backup.source,
    });
    if (backup.students.length === 0) {
      showToast('ยังไม่มีข้อมูลรายชื่อนักเรียนในฐานข้อมูลสำรอง', 'warning');
      return 0;
    }
    const applied = applyPendingItemsToSnapshot(
      {
        students: backup.students,
        parcels: parcelsRef.current,
        members: membersRef.current,
        rolePermissions: rolePermissionsRef.current,
        rateLimitConfig: rateLimitRef.current,
      },
      pendingWritesRef.current
    );
    setStudents(applied.students);
    await saveLocalSearchCache({ students: applied.students });
    showToast(
      `โหลดรายชื่อนักเรียนทั้งหมด ${applied.students.length} คน จากฐานข้อมูลสำรองสำเร็จ`,
      'success'
    );
    return applied.students.length;
  }, [applyPendingItemsToSnapshot, showToast]);

  /**
   * บันทึกหรือแก้ไขข้อมูลนักเรียนรายคนลงไฟล์สำรองในระบบก่อน
   */
  const upsertSingleStudent = useCallback(
    async (student: Omit<Student, 'ownerId' | 'createdAt' | 'updatedAt'>): Promise<void> => {
      const isoNow = new Date().toISOString();
      const code = formatStudentCode(student.studentCode);
      const existing = studentsRef.current.find((s) => s.studentCode === code);
      const studentObj: Student = {
        ...student,
        studentCode: code,
        ownerId: AUTO_CLOUD_OWNER_ID,
        createdAt: existing ? existing.createdAt : isoNow,
        updatedAt: isoNow,
      };

      const nextStudents = [
        studentObj,
        ...studentsRef.current.filter((s) => s.studentCode !== code),
      ].sort((a, b) => a.seqNo - b.seqNo);
      setStudents(nextStudents);

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        [
          {
            id: `students:${code}:${Date.now()}`,
            collection: 'students',
            docId: code,
            action: 'upsert',
            data: studentObj,
            queuedAt: isoNow,
          },
        ],
        { students: nextStudents }
      );
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `บันทึกข้อมูลนักเรียนรหัส ${code} ลงฐานข้อมูล Firestore โดยตรงสำเร็จ`
          : `Quota เต็ม — บันทึกข้อมูลนักเรียนรหัส ${code} ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );
    },
    [commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * ลบข้อมูลนักเรียนรายคนออกจากแคชและพักคำสั่งลบลงไฟล์สำรองก่อน
   */
  const deleteStudent = useCallback(
    async (studentCode: string): Promise<void> => {
      const code = formatStudentCode(studentCode);
      const nextStudents = studentsRef.current.filter(
        (s) => s.studentCode !== code && s.studentCode !== studentCode
      );
      setStudents(nextStudents);

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        [
          {
            id: `students:${code}:${Date.now()}`,
            collection: 'students',
            docId: code,
            action: 'delete',
            queuedAt: new Date().toISOString(),
          },
        ],
        { students: nextStudents }
      );
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `ลบข้อมูลนักเรียนรหัส ${code} ออกจาก Firestore โดยตรงแล้ว`
          : `Quota เต็ม — บันทึกคำสั่งลบนักเรียนรหัส ${code} ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'info' : 'warning'
      );
    },
    [commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * ลบข้อมูลนักเรียนหลายคนลงไฟล์สำรองในระบบก่อน
   */
  const bulkDeleteStudents = useCallback(
    async (studentCodes: string[], targetLabel?: string): Promise<void> => {
      if (studentCodes.length === 0) return;
      const targetSet = new Set(studentCodes.map((c) => formatStudentCode(c)));
      const nextStudents = studentsRef.current.filter(
        (s) => !targetSet.has(s.studentCode) && !studentCodes.includes(s.studentCode)
      );
      setStudents(nextStudents);

      const isoNow = new Date().toISOString();
      const stagedItems: PendingWriteItem[] = studentCodes.map((c) => {
        const code = formatStudentCode(c);
        return {
          id: `students:${code}:${Date.now()}`,
          collection: 'students',
          docId: code,
          action: 'delete',
          queuedAt: isoNow,
        };
      });

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(stagedItems, {
        students: nextStudents,
      });
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `ลบข้อมูลนักเรียน${targetLabel ? ` (${targetLabel})` : ''} จำนวน ${studentCodes.length} คน ออกจาก Firestore โดยตรงสำเร็จ`
          : `Quota เต็ม — บันทึกคำสั่งลบนักเรียน${targetLabel ? ` (${targetLabel})` : ''} ${studentCodes.length} คน ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'info' : 'warning'
      );
    },
    [commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * ล้างข้อมูลนักเรียนทั้งหมดลงไฟล์สำรอง
   */
  const clearAllStudents = useCallback(async () => {
    const allCodes = studentsRef.current.map((s) => s.studentCode);
    if (allCodes.length === 0) {
      showToast('ไม่มีข้อมูลนักเรียนในระบบ', 'info');
      return;
    }
    await bulkDeleteStudents(allCodes, 'ทั้งหมดในระบบ');
  }, [bulkDeleteStudents, showToast]);

  /**
   * บันทึกหรือแก้ไขสมาชิกผู้ใช้ลงไฟล์สำรองในระบบก่อน
   */
  const upsertMember = useCallback(
    async (input: UpsertMemberInput): Promise<Member> => {
      const isExisting = Boolean(
        input.memberId && membersRef.current.some((m) => m.memberId === input.memberId)
      );
      const existingMember = isExisting
        ? membersRef.current.find((m) => m.memberId === input.memberId)
        : undefined;
      const generatedId =
        input.memberId && input.memberId.trim()
          ? sanitizeId(input.memberId.trim(), 64)
          : sanitizeId(`mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`, 64);

      const safeRole: MemberRole =
        input.role === 'ผู้ดูแลระบบ'
          ? 'ผู้ดูแลระบบ'
          : input.role === 'ครู'
          ? 'ครู'
          : 'เจ้าหน้าที่';

      const cleanAllowedMenus: AppMenuKey[] =
        input.allowedMenus && input.allowedMenus.length > 0
          ? Array.from(new Set(input.allowedMenus))
          : safeRole === 'ผู้ดูแลระบบ'
          ? [...ALL_MENU_KEYS]
          : safeRole === 'ครู'
          ? [...DEFAULT_TEACHER_MENU_KEYS]
          : [...DEFAULT_STAFF_MENU_KEYS];

      if (safeRole === 'ผู้ดูแลระบบ' && input.useCustomMenus && !cleanAllowedMenus.includes('members')) {
        cleanAllowedMenus.push('members');
      }

      const defaultCanEdit = safeRole === 'ผู้ดูแลระบบ' ? true : safeRole === 'ครู' ? false : true;
      const defaultCanDelete = safeRole === 'ผู้ดูแลระบบ';
      const isoNow = new Date().toISOString();

      const memberObj: Member = {
        memberId: generatedId,
        username: input.username.trim().slice(0, 80),
        password: input.password.trim().slice(0, 100),
        fullName: input.fullName.trim().slice(0, 150),
        role: safeRole,
        allowedMenus: cleanAllowedMenus,
        useCustomMenus: Boolean(input.useCustomMenus),
        canEdit: input.canEdit !== undefined ? Boolean(input.canEdit) : defaultCanEdit,
        canDelete: input.canDelete !== undefined ? Boolean(input.canDelete) : defaultCanDelete,
        active: input.active !== false,
        ownerId: AUTO_CLOUD_OWNER_ID,
        createdAt: existingMember ? existingMember.createdAt : isoNow,
        updatedAt: isoNow,
      };

      const nextMembers = [
        ...membersRef.current.filter((m) => m.memberId !== generatedId),
        memberObj,
      ];
      setMembers(nextMembers);

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        [
          {
            id: `members:${generatedId}:${Date.now()}`,
            collection: 'members',
            docId: generatedId,
            action: 'upsert',
            data: memberObj,
            queuedAt: isoNow,
          },
        ],
        { members: nextMembers }
      );
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `${isExisting ? 'แก้ไขข้อมูล' : 'เพิ่ม'}สมาชิก "${memberObj.fullName}" (${memberObj.role}) ลง Firestore โดยตรงสำเร็จ`
          : `Quota เต็ม — บันทึกสมาชิก "${memberObj.fullName}" ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );
      return memberObj;
    },
    [commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * ลบสมาชิกออกจากแคชและพักคำสั่งลบลงไฟล์สำรอง
   */
  const deleteMember = useCallback(
    async (memberId: string): Promise<void> => {
      const target = membersRef.current.find((m) => m.memberId === memberId);
      if (!target) return;

      const remainingAdmins = membersRef.current.filter(
        (m) => m.memberId !== memberId && m.role === 'ผู้ดูแลระบบ' && m.active
      );
      if (target.role === 'ผู้ดูแลระบบ' && remainingAdmins.length === 0) {
        showToast('ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายของระบบได้', 'error');
        return;
      }

      const nextMembers = membersRef.current.filter((m) => m.memberId !== memberId);
      setMembers(nextMembers);
      if (currentMemberId === memberId) {
        setCurrentMemberId(null);
      }

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        [
          {
            id: `members:${memberId}:${Date.now()}`,
            collection: 'members',
            docId: memberId,
            action: 'delete',
            queuedAt: new Date().toISOString(),
          },
        ],
        { members: nextMembers }
      );
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `ลบสมาชิก "${target.fullName}" ออกจาก Firestore โดยตรงแล้ว`
          : `Quota เต็ม — บันทึกคำสั่งลบสมาชิก "${target.fullName}" ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'info' : 'warning'
      );
    },
    [currentMemberId, commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  /**
   * บันทึกหรือแก้ไขสิทธิ์ของ Role ลงไฟล์สำรองในระบบก่อน
   */
  const updateRolePermission = useCallback(
    async (
      roleId: 'admin' | 'staff' | 'teacher' | 'user',
      allowedMenus: AppMenuKey[],
      canEdit?: boolean,
      canDelete?: boolean
    ): Promise<void> => {
      const safeMenus: AppMenuKey[] = Array.from(new Set(allowedMenus));
      if (roleId === 'admin' && !safeMenus.includes('members')) {
        safeMenus.push('members');
      }
      if (safeMenus.length === 0) {
        safeMenus.push('inbound');
      }

      const roleName: MemberRole =
        roleId === 'admin'
          ? 'ผู้ดูแลระบบ'
          : roleId === 'teacher'
          ? 'ครู'
          : 'เจ้าหน้าที่';

      const existingRole = rolePermissionsRef.current.find((rp) => rp.roleId === roleId);
      const isoNow = new Date().toISOString();
      const updatedRole: RolePermission = {
        roleId,
        roleName,
        allowedMenus: safeMenus,
        canEdit: canEdit !== undefined ? canEdit : existingRole?.canEdit ?? (roleId !== 'teacher'),
        canDelete:
          canDelete !== undefined ? canDelete : existingRole?.canDelete ?? (roleId === 'admin'),
        ownerId: AUTO_CLOUD_OWNER_ID,
        createdAt: existingRole ? existingRole.createdAt : isoNow,
        updatedAt: isoNow,
      };

      const nextRoles = [
        ...rolePermissionsRef.current.filter((rp) => rp.roleId !== roleId),
        updatedRole,
      ];
      setRolePermissions(nextRoles);

      const writeRes = await commitWritesDirectOrFallbackToLocalStorage(
        [
          {
            id: `role_permissions:${roleId}:${Date.now()}`,
            collection: 'role_permissions',
            docId: roleId,
            action: 'upsert',
            data: updatedRole,
            queuedAt: isoNow,
          },
        ],
        { rolePermissions: nextRoles }
      );
      showToast(
        writeRes.mode === 'firestore_direct'
          ? `บันทึกสิทธิ์ของระดับ "${updatedRole.roleName}" ลง Firestore โดยตรงสำเร็จ`
          : `Quota เต็ม — บันทึกสิทธิ์ของระดับ "${updatedRole.roleName}" ลง localStorage แล้ว`,
        writeRes.mode === 'firestore_direct' ? 'success' : 'warning'
      );
    },
    [commitWritesDirectOrFallbackToLocalStorage, showToast]
  );

  // คำนวณสิทธิ์เมนูที่สมาชิกแต่ละคนมีสิทธิ์เข้าถึง
  const getEffectiveMemberMenus = useCallback(
    (member: Member): AppMenuKey[] => {
      // ผู้ดูแลระบบหลัก (Admin) ต้องมีสิทธิ์เข้าถึงทุกเมนูของระบบเสมอ รวมถึงลบพัสดุจำนวนมากและการตั้งค่าทั้งหมด
      if (member.role === 'ผู้ดูแลระบบ') {
        return [...ALL_MENU_KEYS];
      }
      if (member.useCustomMenus) {
        return member.allowedMenus.length > 0 ? member.allowedMenus : ['inbound'];
      }
      const roleKey = member.role === 'ครู' ? 'teacher' : 'staff';
      const foundRole = rolePermissions.find(
        (rp) => rp.roleId === roleKey || rp.roleName === member.role
      );
      if (foundRole && foundRole.allowedMenus.length > 0) {
        return foundRole.allowedMenus;
      }
      if (member.role === 'ครู') return [...DEFAULT_TEACHER_MENU_KEYS];
      return [...DEFAULT_STAFF_MENU_KEYS];
    },
    [rolePermissions]
  );

  const currentMember = useMemo<Member | null>(() => {
    if (!currentMemberId) return null;
    const found = members.find((m) => m.memberId === currentMemberId);
    if (!found || !found.active) return null;
    return found;
  }, [currentMemberId, members]);

  const allowedMenusForCurrentMember = useMemo<AppMenuKey[]>(() => {
    if (!currentMember) return [];
    if (currentMember.role === 'ผู้ดูแลระบบ') return [...ALL_MENU_KEYS];
    return getEffectiveMemberMenus(currentMember);
  }, [currentMember, getEffectiveMemberMenus]);

  const canCurrentMemberEdit = useMemo<boolean>(() => {
    if (!currentMember) return false;
    if (currentMember.role === 'ผู้ดูแลระบบ') return true;
    if (currentMember.canEdit !== undefined) return Boolean(currentMember.canEdit);
    const roleKey = currentMember.role === 'ครู' ? 'teacher' : 'staff';
    const foundRole = rolePermissions.find(
      (rp) => rp.roleId === roleKey || rp.roleName === currentMember.role
    );
    if (foundRole && foundRole.canEdit !== undefined) return Boolean(foundRole.canEdit);
    return currentMember.role !== 'ครู';
  }, [currentMember, rolePermissions]);

  const canCurrentMemberDelete = useMemo<boolean>(() => {
    if (!currentMember) return false;
    if (currentMember.role === 'ผู้ดูแลระบบ') return true;
    if (currentMember.canDelete !== undefined) return Boolean(currentMember.canDelete);
    const roleKey = currentMember.role === 'ครู' ? 'teacher' : 'staff';
    const foundRole = rolePermissions.find(
      (rp) => rp.roleId === roleKey || rp.roleName === currentMember.role
    );
    if (foundRole && foundRole.canDelete !== undefined) return Boolean(foundRole.canDelete);
    return false;
  }, [currentMember, rolePermissions]);

  const loginWithCredentials = useCallback(
    (usernameInput: string, passwordInput: string): { success: boolean; message: string } => {
      const cleanUser = usernameInput.trim().toLowerCase();
      const cleanPass = passwordInput.trim();

      if (!cleanUser || !cleanPass) {
        return { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน' };
      }

      const matched = members.find(
        (m) => m.username.trim().toLowerCase() === cleanUser && m.password === cleanPass
      );

      if (!matched) {
        return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
      }

      if (!matched.active) {
        return { success: false, message: 'บัญชีผู้ใช้นี้ถูกระงับการใช้งานชั่วคราว กรุณาติดต่อผู้ดูแลระบบ' };
      }

      setCurrentMemberId(matched.memberId);
      showToast(`เข้าสู่ระบบสำเร็จ: ${matched.fullName} (${matched.role})`, 'success');
      return { success: true, message: 'เข้าสู่ระบบสำเร็จ' };
    },
    [members, showToast]
  );

  const loginWithGoogleAccount = useCallback(async (): Promise<{
    success: boolean;
    message: string;
  }> => {
    try {
      const loggedInUser = await signInWithGooglePopup();
      const emailLower = (loggedInUser.email || '').trim().toLowerCase();
      const matched = members.find(
        (m) =>
          m.username.trim().toLowerCase() === emailLower ||
          (emailLower === AUTO_CLOUD_EMAIL.toLowerCase() && m.role === 'ผู้ดูแลระบบ')
      );

      if (matched) {
        if (!matched.active) {
          return { success: false, message: 'บัญชีนี้ถูกปิดการใช้งาน' };
        }
        setCurrentMemberId(matched.memberId);
        showToast(`เข้าสู่ระบบด้วย Google สำเร็จ: ${matched.fullName} (${matched.role})`, 'success');
        return { success: true, message: 'เข้าสู่ระบบสำเร็จ' };
      }

      const fallbackAdmin = members.find((m) => m.role === 'ผู้ดูแลระบบ' && m.active) || members[0];
      if (fallbackAdmin) {
        setCurrentMemberId(fallbackAdmin.memberId);
        showToast(
          `เข้าสู่ระบบสำเร็จภายใต้ ${loggedInUser.email || AUTO_CLOUD_EMAIL} (${fallbackAdmin.role})`,
          'success'
        );
        return { success: true, message: 'เข้าสู่ระบบสำเร็จ' };
      }

      return { success: false, message: 'ไม่พบบัญชีสมาชิกที่ผูกกับอีเมลนี้' };
    } catch {
      return { success: false, message: 'ยกเลิกหรือเกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Google' };
    }
  }, [members, showToast]);

  const logoutMember = useCallback(() => {
    setCurrentMemberId(null);
    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
  }, [showToast]);

  // สรุปยอดรับเข้าพัสดุทั้งหมดรวมทุก User ในฐานข้อมูลสำรอง และรายการพร้อมอัปโหลดขึ้น Firebase
  const parcelBackupSummary = useMemo<ParcelBackupSummary>(() => {
    const todayYMD = getRelativeDateString(0);
    const memberById = new Map<string, Member>();
    for (const m of members) {
      memberById.set(m.memberId, m);
    }

    const pendingParcelMap = new Map<string, PendingWriteItem>();
    for (const item of pendingWrites) {
      if (item.collection === 'parcels') {
        pendingParcelMap.set(item.docId, item);
      }
    }

    const userStatsMap = new Map<string, UserParcelBackupStat>();
    const ensureUserStat = (
      userKey: string,
      userName: string,
      userRole: string
    ): UserParcelBackupStat => {
      let existing = userStatsMap.get(userKey);
      if (!existing) {
        const matchedMember = memberById.get(userKey);
        existing = {
          userKey,
          userName: matchedMember?.fullName || userName || 'ระบบสำรองกลาง',
          userRole: matchedMember?.role || userRole || 'ระบบ',
          totalParcels: 0,
          todayParcels: 0,
          pendingUploadCount: 0,
          lastRecordedAt: null,
        };
        userStatsMap.set(userKey, existing);
      }
      return existing;
    };

    let todayParcelsInBackup = 0;
    let unstagedBackupParcelsCount = 0;

    for (const p of parcels) {
      const key = p.id || p.trackingNumber;
      const pYmd = p.receivedDate || extractParcelLocalYMD(p);
      const isToday = pYmd === todayYMD;
      if (isToday) todayParcelsInBackup++;

      const pendingItem = pendingParcelMap.get(key);
      if (!pendingItem) {
        unstagedBackupParcelsCount++;
      }

      const userKey =
        p.recordedByMemberId ||
        pendingItem?.queuedByMemberId ||
        'shared_system';
      const userName =
        p.recordedByName ||
        pendingItem?.queuedByName ||
        'ข้อมูลซิงค์กลาง / ไม่ระบุผู้บันทึก';
      const userRole =
        p.recordedByRole ||
        pendingItem?.queuedByRole ||
        'ระบบสำรองกลาง';

      const stat = ensureUserStat(userKey, userName, userRole);
      stat.totalParcels++;
      if (isToday) stat.todayParcels++;
      if (pendingItem) stat.pendingUploadCount++;

      const ts = p.updatedAt || p.createdAt;
      if (ts && (!stat.lastRecordedAt || ts > stat.lastRecordedAt)) {
        stat.lastRecordedAt = ts;
      }
    }

    // รวมรายการพัสดุในคิว pendingWrites ที่ยังไม่อยู่ใน parcels array (เช่น คำสั่งลบ)
    const existingParcelIds = new Set(parcels.map((p) => p.id || p.trackingNumber));
    for (const item of pendingWrites) {
      if (item.collection === 'parcels' && !existingParcelIds.has(item.docId)) {
        const userKey = item.queuedByMemberId || 'shared_system';
        const userName = item.queuedByName || 'ข้อมูลซิงค์กลาง / ไม่ระบุผู้บันทึก';
        const userRole = item.queuedByRole || 'ระบบสำรองกลาง';
        const stat = ensureUserStat(userKey, userName, userRole);
        stat.pendingUploadCount++;
        if (item.queuedAt && (!stat.lastRecordedAt || item.queuedAt > stat.lastRecordedAt)) {
          stat.lastRecordedAt = item.queuedAt;
        }
      }
    }

    const byUser = Array.from(userStatsMap.values()).sort(
      (a, b) =>
        b.totalParcels - a.totalParcels ||
        b.todayParcels - a.todayParcels ||
        b.pendingUploadCount - a.pendingUploadCount ||
        a.userName.localeCompare(b.userName, 'th')
    );

    return {
      totalParcelsInBackup: parcels.length,
      todayParcelsInBackup,
      pendingParcelsToUpload: pendingParcelMap.size,
      totalPendingItemsToUpload: pendingWrites.length,
      unstagedBackupParcelsCount,
      byUser,
      serverFileActive: parcelBackupStatus.serverFileActive || localBackupStatus.serverFileActive,
      indexedDbActive: parcelBackupStatus.indexedDbActive,
      backupFilePath: parcelBackupStatus.filePath || 'data/parcels-backup.json',
      updatedAt: parcelBackupStatus.updatedAt,
    };
  }, [parcels, pendingWrites, members, parcelBackupStatus, localBackupStatus.serverFileActive]);

  // เตรียมพัสดุทั้งหมดในฐานข้อมูลสำรอง (ทุก User) ลงคิวพร้อมอัปโหลดขึ้น Firebase
  const stageAllBackupParcelsForUpload = useCallback(async (): Promise<number> => {
    const allParcels = parcelsRef.current;
    if (allParcels.length === 0) {
      showToast('ยังไม่มีข้อมูลพัสดุในฐานข้อมูลสำรอง', 'info');
      return 0;
    }

    const pendingParcelKeys = new Set(
      pendingWritesRef.current
        .filter((item) => item.collection === 'parcels')
        .map((item) => item.docId)
    );

    const isoNow = new Date().toISOString();
    const actor = getCurrentActorAttribution();
    const newItems: PendingWriteItem[] = [];

    for (const p of allParcels) {
      const key = (p.id || p.trackingNumber || '').trim();
      if (!key || pendingParcelKeys.has(key)) continue;
      newItems.push({
        id: `parcels:${key}:${Date.now()}`,
        collection: 'parcels',
        docId: key,
        action: 'upsert',
        data: p,
        queuedAt: isoNow,
        queuedByMemberId: p.recordedByMemberId || actor.memberId,
        queuedByName: p.recordedByName || actor.name,
        queuedByRole: p.recordedByRole || actor.role,
      });
    }

    await saveAllParcelsToBackupDb(allParcels, 'manual_stage_all_backup');

    if (newItems.length === 0) {
      showToast(
        `พัสดุทั้งหมด ${allParcels.length} ชิ้น อยู่ในคิวพร้อมอัปโหลดขึ้น Firebase เรียบร้อยแล้ว`,
        'info'
      );
      return 0;
    }

    await stagePendingWrites(newItems, { parcels: allParcels });
    showToast(
      `เตรียมพัสดุจากฐานข้อมูลสำรองเพิ่มอีก ${newItems.length} ชิ้น (รวมทั้งหมด ${pendingWritesRef.current.length} รายการพร้อมอัปโหลดขึ้น Firebase)`,
      'success'
    );
    return newItems.length;
  }, [getCurrentActorAttribution, stagePendingWrites, showToast]);

  // ฟังก์ชันอัปโหลดข้อมูลจากไฟล์สำรองขึ้น Firebase (และลบไฟล์สำรองเมื่อสำเร็จ)
  const uploadStagedToFirebaseNow = useCallback(async (): Promise<void> => {
    await uploadStagedToFirebase({ isAutoMidnight: false });
  }, [uploadStagedToFirebase]);

  // เตรียมพัสดุทั้งหมดในฐานข้อมูลสำรอง (ทุก User) และอัปโหลดขึ้น Firebase ทันที
  const uploadAllBackupParcelsToFirebaseNow = useCallback(async (): Promise<void> => {
    if (parcelsRef.current.length === 0 && pendingWritesRef.current.length === 0) {
      showToast('ยังไม่มีข้อมูลพัสดุในฐานข้อมูลสำรองสำหรับอัปโหลด', 'info');
      return;
    }

    const pendingParcelKeys = new Set(
      pendingWritesRef.current
        .filter((item) => item.collection === 'parcels')
        .map((item) => item.docId)
    );
    const hasUnstaged = parcelsRef.current.some(
      (p) => !pendingParcelKeys.has((p.id || p.trackingNumber || '').trim())
    );
    if (hasUnstaged) {
      await stageAllBackupParcelsForUpload();
    }
    await uploadStagedToFirebase({ isAutoMidnight: false });
  }, [stageAllBackupParcelsForUpload, uploadStagedToFirebase, showToast]);

  const syncPendingToFirebase = useCallback(async (): Promise<void> => {
    if (pendingWritesRef.current.length > 0) {
      await uploadStagedToFirebase({ isAutoMidnight: false });
    } else {
      await loadDataDirectlyFromFirestore();
      showToast('ดึงข้อมูลล่าสุดจากฐานข้อมูล Firestore และอัปเดตแคชในระบบสำเร็จ', 'success');
    }
  }, [uploadStagedToFirebase, loadDataDirectlyFromFirestore, showToast]);

  const pullFromFirebaseToLocal = useCallback(async (): Promise<void> => {
    const res = await loadDataDirectlyFromFirestore();
    if (res.success) {
      showToast(
        `ดึงข้อมูลจาก Firebase และบันทึกรายชื่อนักเรียน ${studentsRef.current.length} คน ลงฐานข้อมูลสำรองแล้ว`,
        'success'
      );
    }
  }, [loadDataDirectlyFromFirestore, showToast]);

  const clearAllLocalData = useCallback(() => {
    purgeLocalMachineData();
    void clearStagedBackupAfterUpload({
      lastAutoUploadDate: localBackupStatusRef.current.lastAutoUploadDate,
      lastUploadedAt: new Date().toISOString(),
    });
    pendingWritesRef.current = [];
    setPendingWrites([]);
    setLocalBackupStatus((prev) => ({
      ...prev,
      stagingFileExists: false,
      stagedCount: 0,
    }));
    showToast('ล้างข้อมูลไฟล์สำรองในระบบเรียบร้อยแล้ว', 'info');
  }, [showToast]);

  const signInGoogle = useCallback(async () => {
    try {
      const loggedInUser = await signInWithGooglePopup();
      showToast(`ยืนยันตัวตนบัญชี Google สำเร็จ: ${loggedInUser.email || AUTO_CLOUD_EMAIL}`, 'success');
      await loadDataDirectlyFromFirestore();
    } catch {
      showToast(
        `ระบบเชื่อมต่ออัตโนมัติภายใต้บัญชี ${AUTO_CLOUD_EMAIL}`,
        'success'
      );
    }
  }, [showToast, loadDataDirectlyFromFirestore]);

  const signOutUser = useCallback(async () => {
    await signOutFirebaseUser();
    showToast(`ออกจากบัญชี Google (ยังคงทำงานกับฐานข้อมูลหลัก ${AUTO_CLOUD_EMAIL})`, 'info');
  }, [showToast]);

  const setSyncMode = useCallback((_mode: SyncMode) => {
    // โหมดอัตโนมัติ: ตรวจ Quota ก่อน ถ้าไม่เต็มบันทึกลง Firestore โดยตรง ถ้า Quota เต็มบันทึกลง localStorage
  }, []);

  // ตรวจสอบสถานะ Quota ของ Firestore ใหม่แบบสด (เมื่อ user กดปุ่มตรวจโควตา)
  const recheckFirestoreQuota = useCallback(async (): Promise<FirestoreQuotaStatus> => {
    hasShownQuotaNoticeRef.current = false;
    const status = await checkAndSyncQuotaStatus(true);
    if (status.available) {
      const pendingCount = pendingWritesRef.current.length;
      showToast(
        pendingCount > 0
          ? `Firestore พร้อมใช้งานแล้ว (Quota ไม่เต็ม) — สามารถบันทึกตรงและอัปโหลดค้างใน localStorage ${pendingCount} รายการเข้า Firestore ได้ทันที`
          : 'Firestore พร้อมใช้งานแล้ว (Quota ไม่เต็ม) — ระบบจะรับข้อมูลลงฐานข้อมูลโดยตรงทันที',
        'success'
      );
    } else if (status.quotaExceeded) {
      showToast(
        'Quota ของ Firestore ยังเต็มอยู่ — ระบบจะบันทึกลง localStorage ต่อเนื่องและให้ส่งออกหรืออัปโหลดภายหลัง',
        'warning'
      );
    } else {
      showToast(
        'ยังไม่สามารถเชื่อมต่อ Firestore ได้ — ระบบจะบันทึกลง localStorage ชั่วคราว',
        'warning'
      );
    }
    return status;
  }, [checkAndSyncQuotaStatus, showToast]);

  // ส่งออกข้อมูลที่บันทึกไว้ใน localStorage (รองรับทั้งคิวรอส่งและข้อมูลสำรองในเครื่อง) เป็นไฟล์ JSON
  const exportLocalStoragePendingJson = useCallback(() => {
    let rawPending: PendingWriteItem[] = pendingWritesRef.current;
    try {
      const fromLs = localStorage.getItem(LOCAL_STAGING_STORAGE_KEY);
      if (fromLs) {
        const parsed = JSON.parse(fromLs) as PendingWriteItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          rawPending = parsed;
        }
      }
    } catch {
      // fallback to ref
    }

    const pendingParcels: Parcel[] = [];
    const pendingStudents: Student[] = [];
    for (const item of rawPending) {
      if (item.collection === 'parcels' && item.action !== 'delete' && item.data) {
        pendingParcels.push(item.data as Parcel);
      } else if (item.collection === 'students' && item.action !== 'delete' && item.data) {
        pendingStudents.push(item.data as Student);
      }
    }

    const usePendingOnly = pendingParcels.length > 0 || pendingStudents.length > 0;
    const exportParcels = usePendingOnly ? pendingParcels : parcelsRef.current;
    const exportStudents = usePendingOnly ? pendingStudents : studentsRef.current;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}`;

    const payload = {
      meta: {
        system: 'Student Parcel Management & Tracking System',
        source: 'localStorage',
        scope: usePendingOnly ? 'localStorage_pending_queue' : 'localStorage_backup_cache',
        quotaExceeded: quotaExceededRef.current,
        exportedAt: now.toISOString(),
        pendingCount: rawPending.length,
        parcelsCount: exportParcels.length,
        studentsCount: exportStudents.length,
      },
      students: exportStudents,
      parcels: exportParcels,
      pendingWrites: rawPending,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SPMS_LOCALSTORAGE_${usePendingOnly ? 'PENDING' : 'BACKUP'}_${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(
      `ส่งออกไฟล์ JSON จาก localStorage สำเร็จ (พัสดุ ${exportParcels.length} ชิ้น, นักเรียน ${exportStudents.length} คน)`,
      'success'
    );
  }, [showToast]);

  // ส่งออกรายการพัสดุใน localStorage เป็นไฟล์ CSV (รองรับภาษาไทยใน Excel)
  const exportLocalStorageParcelsCsv = useCallback(() => {
    let rawPending: PendingWriteItem[] = pendingWritesRef.current;
    try {
      const fromLs = localStorage.getItem(LOCAL_STAGING_STORAGE_KEY);
      if (fromLs) {
        const parsed = JSON.parse(fromLs) as PendingWriteItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          rawPending = parsed;
        }
      }
    } catch {
      // fallback to ref
    }

    const pendingParcels = rawPending
      .filter((item) => item.collection === 'parcels' && item.action !== 'delete' && item.data)
      .map((item) => item.data as Parcel);

    const exportParcels = pendingParcels.length > 0 ? pendingParcels : parcelsRef.current;
    if (exportParcels.length === 0) {
      showToast('ยังไม่มีข้อมูลพัสดุใน localStorage สำหรับส่งออก', 'warning');
      return;
    }

    const esc = (v: string | number | undefined | null) => {
      if (v === undefined || v === null) return '""';
      return `"${String(v).replace(/"/g, '""')}"`;
    };

    const headers = [
      'เลขติดตามพัสดุ',
      'รหัสนักเรียน',
      'ชื่อ-นามสกุลนักเรียน',
      'ชื่อเล่น',
      'ชั้น/ห้อง',
      'หอพัก',
      'ห้องพักหอ',
      'เตียง',
      'ประเภทสิ่งของ',
      'สถานะพัสดุ',
      'บริษัทขนส่ง',
      'วันที่รับเข้า',
      'ชั่วโมงรับเข้า',
      'วันที่ส่งมอบ',
      'หมายเหตุ',
      'ผู้บันทึก',
    ];
    const rows = exportParcels.map((p) => [
      esc(p.trackingNumber),
      esc(p.studentCode),
      esc(p.studentFullName),
      esc(p.nickname),
      esc(p.gradeRoom),
      esc(p.dormitory),
      esc(p.dormRoom),
      esc(p.bed),
      esc(p.category),
      esc(p.status),
      esc(p.courier),
      esc(p.receivedDate),
      esc(p.receivedHour),
      esc(p.deliveredDate || ''),
      esc(p.note),
      esc(p.recordedByName || ''),
    ]);

    const csvStr = '\uFEFF' + [headers.map(esc).join(','), ...rows.map((r) => r.join(','))].join('\n');
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}`;

    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SPMS_LOCALSTORAGE_PARCELS_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(
      `ส่งออกไฟล์ CSV จาก localStorage สำเร็จ (${exportParcels.length} รายการ)`,
      'success'
    );
  }, [showToast]);

  const value = useMemo<ParcelSystemContextValue>(
    () => ({
      user,
      connectedEmail,
      authReady,
      currentMember,
      members,
      rolePermissions,
      allowedMenusForCurrentMember,
      canCurrentMemberEdit,
      canCurrentMemberDelete,
      loginWithCredentials,
      loginWithGoogleAccount,
      logoutMember,
      upsertMember,
      deleteMember,
      updateRolePermission,
      getEffectiveMemberMenus,
      students,
      studentMap,
      parcels,
      parcelRateLimitConfig,
      updateParcelRateLimitConfig,
      studentParcelStatsMap,
      allStudentParcelStats,
      overWeeklyLimitStudents,
      overLimitStudents,
      getStudentParcelCounts,
      weeklyWarningPopup,
      openWeeklyWarningPopup,
      closeWeeklyWarningPopup,
      pendingWrites,
      localBackupStatus,
      studentBackupStatus,
      parcelBackupStatus,
      parcelBackupSummary,
      firestoreConnectionStatus,
      lastQuotaCheckAt,
      lastWriteMode,
      quotaMetrics,
      syncMode,
      isSyncing,
      quotaExceeded,
      syncProgress,
      toastMessage,
      clearToast,
      setSyncMode,
      recheckFirestoreQuota,
      exportLocalStoragePendingJson,
      exportLocalStorageParcelsCsv,
      lookupStudentByCode,
      lookupStudentWithCloudFallback,
      searchStudentsLocal,
      searchParcelsLocal,
      searchParcelsWithCloudFallback,
      recordLocalSearchSaving,
      addInboundParcel,
      updateParcelStatus,
      updateParcelDetails,
      bulkUpdateParcelStatus,
      deleteParcel,
      bulkDeleteParcels,
      bulkDeleteParcelsByDorm,
      clearAllParcels,
      bulkImportParcels,
      fullRestoreSystemBackup,
      bulkImportStudents,
      upsertSingleStudent,
      deleteStudent,
      bulkDeleteStudents,
      clearAllStudents,
      backupAllStudentsNow,
      restoreStudentsFromBackupDb,
      stageAllBackupParcelsForUpload,
      uploadAllBackupParcelsToFirebaseNow,
      refreshFromLocalBackupServer,
      syncPendingToFirebase,
      uploadStagedToFirebaseNow,
      pullFromFirebaseToLocal,
      clearAllLocalData,
      signInGoogle,
      signOutUser,
    }),
    [
      user,
      connectedEmail,
      authReady,
      currentMember,
      members,
      rolePermissions,
      allowedMenusForCurrentMember,
      canCurrentMemberEdit,
      canCurrentMemberDelete,
      loginWithCredentials,
      loginWithGoogleAccount,
      logoutMember,
      upsertMember,
      deleteMember,
      updateRolePermission,
      getEffectiveMemberMenus,
      students,
      studentMap,
      parcels,
      parcelRateLimitConfig,
      updateParcelRateLimitConfig,
      studentParcelStatsMap,
      allStudentParcelStats,
      overWeeklyLimitStudents,
      overLimitStudents,
      getStudentParcelCounts,
      weeklyWarningPopup,
      openWeeklyWarningPopup,
      closeWeeklyWarningPopup,
      pendingWrites,
      localBackupStatus,
      studentBackupStatus,
      parcelBackupStatus,
      parcelBackupSummary,
      firestoreConnectionStatus,
      lastQuotaCheckAt,
      lastWriteMode,
      quotaMetrics,
      syncMode,
      isSyncing,
      quotaExceeded,
      syncProgress,
      toastMessage,
      clearToast,
      setSyncMode,
      recheckFirestoreQuota,
      exportLocalStoragePendingJson,
      exportLocalStorageParcelsCsv,
      lookupStudentByCode,
      lookupStudentWithCloudFallback,
      searchStudentsLocal,
      searchParcelsLocal,
      searchParcelsWithCloudFallback,
      recordLocalSearchSaving,
      addInboundParcel,
      updateParcelStatus,
      updateParcelDetails,
      bulkUpdateParcelStatus,
      deleteParcel,
      bulkDeleteParcels,
      bulkDeleteParcelsByDorm,
      clearAllParcels,
      bulkImportParcels,
      fullRestoreSystemBackup,
      bulkImportStudents,
      upsertSingleStudent,
      deleteStudent,
      bulkDeleteStudents,
      clearAllStudents,
      backupAllStudentsNow,
      restoreStudentsFromBackupDb,
      stageAllBackupParcelsForUpload,
      uploadAllBackupParcelsToFirebaseNow,
      refreshFromLocalBackupServer,
      syncPendingToFirebase,
      uploadStagedToFirebaseNow,
      pullFromFirebaseToLocal,
      clearAllLocalData,
      signInGoogle,
      signOutUser,
    ]
  );

  return <ParcelSystemContext.Provider value={value}>{children}</ParcelSystemContext.Provider>;
};

export function useParcelSystem(): ParcelSystemContextValue {
  const ctx = useContext(ParcelSystemContext);
  if (!ctx) {
    throw new Error('useParcelSystem must be used within a ParcelSystemProvider');
  }
  return ctx;
}
