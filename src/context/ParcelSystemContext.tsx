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
  SupabaseWriteItem,
  SupabaseParcelSummary,
  UserParcelStat,
  SupabaseConnectionStatus,
  QuotaMetrics,
  getRelativeDateString,
  extractParcelLocalYMD,
  isUnknownOwnerParcel,
  StudentParcelCountStats,
  ParcelRateLimitConfig,
  DEFAULT_PARCEL_RATE_LIMIT_CONFIG,
  WriteTargetMode,
  SupabaseStatusCheck,
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
  fetchCloudDataDirectly as fetchLegacyFirestoreDataDirectly,
} from '../services/firebase';
import {
  initializeDefaultSupabaseDataIfEmpty,
  fetchCloudDataFromSupabase,
  saveBatchDirectlyToSupabase,
  findStudentInSupabaseFallback,
  findParcelInSupabaseFallback,
  checkSupabaseStatus,
  checkSupabaseDetailedStatus,
  SupabaseConnectionDetails,
  isSupabaseTableMissingError,
  SUPABASE_SETUP_SQL,
  sanitizeId,
  AUTO_CLOUD_EMAIL,
  AUTO_CLOUD_OWNER_ID,
} from '../services/supabase';

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
  supabaseParcelSummary: SupabaseParcelSummary;
  supabaseConnectionStatus: SupabaseConnectionStatus;
  lastConnectionCheckAt: string | null;
  lastWriteMode: WriteTargetMode;
  quotaMetrics: QuotaMetrics;
  isSyncing: boolean;
  supabaseSchemaMissing: boolean;
  supabaseConnectionDetails: SupabaseConnectionDetails | null;
  isCheckingSupabaseStatus: boolean;
  syncProgress: { completed: number; total: number } | null;
  toastMessage: { text: string; type: 'success' | 'info' | 'warning' | 'error' } | null;
  clearToast: () => void;
  recheckSupabaseStatus: () => Promise<SupabaseStatusCheck>;
  refreshSupabaseConnectionStatus: (showToastNotification?: boolean) => Promise<SupabaseConnectionDetails>;
  copySupabaseSetupSql: () => Promise<boolean>;
  migrateAllDataToSupabase: () => Promise<void>;
  exportParcelsJson: () => void;
  exportParcelsCsv: () => void;
  lookupStudentByCode: (code: string) => Student | undefined;
  lookupStudentWithCloudFallback: (code: string) => Promise<{
    student: Student | undefined;
    source: 'memory' | 'supabase' | 'none';
  }>;
  searchStudentsLocal: (keyword: string) => Student[];
  searchParcelsLocal: (keyword: string, statusFilter?: string, dormFilter?: string, dateFilter?: string) => Parcel[];
  searchParcelsWithCloudFallback: (
    keyword: string,
    statusFilter?: string,
    dormFilter?: string,
    dateFilter?: string
  ) => Promise<{ parcels: Parcel[]; source: 'memory' | 'supabase' }>;
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
  bulkImportStudents: (newStudents: Omit<Student, 'ownerId' | 'createdAt' | 'updatedAt'>[]) => Promise<number>;
  upsertSingleStudent: (student: Omit<Student, 'ownerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  deleteStudent: (studentCode: string) => Promise<void>;
  bulkDeleteStudents: (studentCodes: string[], targetLabel?: string) => Promise<void>;
  clearAllStudents: () => Promise<void>;
  refreshFromSupabase: () => Promise<void>;
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

const LOGIN_SESSION_STORAGE_KEY = 'spms_login_session_v1';
const ACTIVE_TAB_SESSION_STORAGE_KEY = 'spms_active_tab_v1';

interface StoredLoginSession {
  memberId: string;
  memberSnapshot?: Omit<Member, 'password'>;
  loggedInAt: string;
}

function readStoredLoginSession(): StoredLoginSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(LOGIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLoginSession>;
    if (!parsed || typeof parsed.memberId !== 'string' || !parsed.memberId.trim()) {
      return null;
    }
    return {
      memberId: parsed.memberId.trim(),
      memberSnapshot: parsed.memberSnapshot,
      loggedInAt:
        typeof parsed.loggedInAt === 'string' ? parsed.loggedInAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeStoredLoginSession(member: Member): void {
  if (typeof window === 'undefined') return;
  try {
    const { password: _omittedPassword, ...safeSnapshot } = member;
    const payload: StoredLoginSession = {
      memberId: member.memberId,
      memberSnapshot: safeSnapshot,
      loggedInAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(LOGIN_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function clearStoredLoginSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(LOGIN_SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(ACTIVE_TAB_SESSION_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export const ParcelSystemProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseAuthUser, setFirebaseAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(true);

  const user = useMemo<User>(() => firebaseAuthUser || AUTO_BOUND_USER, [firebaseAuthUser]);
  const connectedEmail = AUTO_CLOUD_EMAIL;

  // ข้อมูลทั้งหมดโหลดและบันทึกโดยตรงกับ Supabase (ไม่มีการจัดเก็บใน localStorage หรือฐานข้อมูลในเครื่อง)
  const [students, setStudents] = useState<Student[]>([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [members, setMembers] = useState<Member[]>(INITIAL_MEMBERS);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>(INITIAL_ROLE_PERMISSIONS);
  const [parcelRateLimitConfig, setParcelRateLimitConfig] = useState<ParcelRateLimitConfig>(
    DEFAULT_PARCEL_RATE_LIMIT_CONFIG
  );

  // จดจำสถานะการล็อกอินไว้ใน sessionStorage (คงอยู่เมื่อรีเฟรชหน้า และล้างอัตโนมัติเมื่อออกจากระบบหรือปิดหน้าเว็บเบราว์เซอร์)
  const [initialSession] = useState<StoredLoginSession | null>(() => readStoredLoginSession());
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(
    () => initialSession?.memberId ?? null
  );
  const [sessionMemberSnapshot, setSessionMemberSnapshot] = useState<Member | null>(() =>
    initialSession?.memberSnapshot
      ? { ...initialSession.memberSnapshot, password: '' }
      : null
  );
  const [hasLoadedCloudMembers, setHasLoadedCloudMembers] = useState<boolean>(false);

  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [supabaseSchemaMissing, setSupabaseSchemaMissing] = useState<boolean>(false);
  const [supabaseConnectionDetails, setSupabaseConnectionDetails] =
    useState<SupabaseConnectionDetails | null>(null);
  const [isCheckingSupabaseStatus, setIsCheckingSupabaseStatus] = useState<boolean>(false);
  const [supabaseConnectionStatus, setSupabaseConnectionStatus] =
    useState<SupabaseConnectionStatus>('connected');
  const [lastConnectionCheckAt, setLastConnectionCheckAt] = useState<string | null>(null);
  const [lastWriteMode, setLastWriteMode] = useState<WriteTargetMode>('supabase_direct');
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);
  const hasBootstrappedRef = useRef<boolean>(false);
  const isUploadingRef = useRef<boolean>(false);
  const lastConnectionProbeTimeRef = useRef<number>(0);
  const lastRefreshTimeRef = useRef<number>(0);
  const supabaseSchemaMissingRef = useRef<boolean>(false);
  const supabaseConnectionStatusRef = useRef<SupabaseConnectionStatus>('connected');

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
    supabaseReadsUsed: 0,
    supabaseWritesUsed: 0,
    lastSyncedAt: null,
  });

  const studentsRef = useRef<Student[]>(students);
  const parcelsRef = useRef<Parcel[]>(parcels);
  const membersRef = useRef<Member[]>(members);
  const currentMemberIdRef = useRef<string | null>(currentMemberId);
  const rolePermissionsRef = useRef<RolePermission[]>(rolePermissions);
  const rateLimitRef = useRef<ParcelRateLimitConfig>(parcelRateLimitConfig);

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
    supabaseSchemaMissingRef.current = supabaseSchemaMissing;
  }, [supabaseSchemaMissing]);

  useEffect(() => {
    supabaseConnectionStatusRef.current = supabaseConnectionStatus;
  }, [supabaseConnectionStatus]);

  const getCurrentActorAttribution = useCallback(() => {
    const activeId = currentMemberIdRef.current;
    const matched = activeId
      ? membersRef.current.find((m) => m.memberId === activeId && m.active)
      : null;
    if (!matched) {
      return {
        memberId: 'shared_system',
        name: 'ผู้ใช้งานระบบ',
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

  // ติดตามสถานะ Firebase Auth (เฉพาะกรณีผู้ใช้ล็อกอินด้วย Google)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setFirebaseAuthUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // ตรวจสอบสถานะการเชื่อมต่อ Supabase
  const checkAndSyncConnectionStatus = useCallback(
    async (force = false): Promise<SupabaseStatusCheck> => {
      const nowMs = Date.now();
      const cacheTtlMs = supabaseSchemaMissingRef.current ? 10_000 : 30_000;
      if (!force && lastConnectionProbeTimeRef.current > 0 && nowMs - lastConnectionProbeTimeRef.current < cacheTtlMs) {
        return {
          available:
            !supabaseSchemaMissingRef.current &&
            supabaseConnectionStatusRef.current === 'connected',
          connectionFailed: supabaseConnectionStatusRef.current !== 'connected',
          schemaMissing: supabaseSchemaMissingRef.current,
          checkedAt: new Date(lastConnectionProbeTimeRef.current).toISOString(),
        };
      }

      const status = await checkSupabaseStatus();
      lastConnectionProbeTimeRef.current = Date.now();
      setLastConnectionCheckAt(status.checkedAt);

      if (status.schemaMissing) {
        setSupabaseSchemaMissing(true);
        supabaseSchemaMissingRef.current = true;
        setSupabaseConnectionStatus('schema_missing');
        supabaseConnectionStatusRef.current = 'schema_missing';
      } else if (status.connectionFailed) {
        setSupabaseSchemaMissing(false);
        supabaseSchemaMissingRef.current = false;
        setSupabaseConnectionStatus('disconnected');
        supabaseConnectionStatusRef.current = 'disconnected';
      } else {
        setSupabaseSchemaMissing(false);
        supabaseSchemaMissingRef.current = false;
        setSupabaseConnectionStatus('connected');
        supabaseConnectionStatusRef.current = 'connected';
      }

      return status;
    },
    []
  );

  /**
   * บันทึกหรือลบข้อมูลลง Supabase โดยตรงทันที (ไม่มีการบันทึกลง localStorage)
   */
  const commitWritesDirectlyToSupabase = useCallback(
    async (
      items: SupabaseWriteItem[],
      showProgress = false
    ): Promise<{
      mode: WriteTargetMode;
      uploadedCount: number;
      schemaMissing?: boolean;
      errorMessage?: string;
    }> => {
      if (items.length === 0) {
        return { mode: 'supabase_direct', uploadedCount: 0 };
      }

      try {
        if (showProgress) {
          setSyncProgress({ completed: 0, total: items.length });
        }
        const result = await saveBatchDirectlyToSupabase(
          items,
          AUTO_CLOUD_OWNER_ID,
          showProgress ? (completed, total) => setSyncProgress({ completed, total }) : undefined
        );

        if (!result.connectionFailed && !result.schemaMissing) {
          const nowIso = new Date().toISOString();
          setSupabaseSchemaMissing(false);
          supabaseSchemaMissingRef.current = false;
          setSupabaseConnectionStatus('connected');
          supabaseConnectionStatusRef.current = 'connected';
          setLastWriteMode('supabase_direct');
          setLastConnectionCheckAt(nowIso);
          lastConnectionProbeTimeRef.current = Date.now();

          setQuotaMetrics((prev) => ({
            ...prev,
            supabaseWritesUsed: prev.supabaseWritesUsed + result.uploadedCount,
            lastSyncedAt: nowIso,
          }));

          return { mode: 'supabase_direct', uploadedCount: result.uploadedCount };
        }

        if (result.schemaMissing) {
          setSupabaseSchemaMissing(true);
          supabaseSchemaMissingRef.current = true;
          setSupabaseConnectionStatus('schema_missing');
          supabaseConnectionStatusRef.current = 'schema_missing';
        } else {
          setSupabaseConnectionStatus('disconnected');
          supabaseConnectionStatusRef.current = 'disconnected';
        }
        setLastWriteMode('supabase_error');
        return {
          mode: 'supabase_error',
          uploadedCount: result.uploadedCount,
          schemaMissing: result.schemaMissing,
          errorMessage: result.errorMessage,
        };
      } catch (err) {
        const schemaMissing = isSupabaseTableMissingError(err);
        if (schemaMissing) {
          setSupabaseSchemaMissing(true);
          supabaseSchemaMissingRef.current = true;
          setSupabaseConnectionStatus('schema_missing');
          supabaseConnectionStatusRef.current = 'schema_missing';
        } else {
          setSupabaseConnectionStatus('disconnected');
          supabaseConnectionStatusRef.current = 'disconnected';
        }
        setLastWriteMode('supabase_error');
        return {
          mode: 'supabase_error',
          uploadedCount: 0,
          schemaMissing,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      } finally {
        if (showProgress) {
          setSyncProgress(null);
        }
      }
    },
    []
  );

  // ดึงข้อมูลทั้งหมดจาก Supabase โดยตรง
  const loadDataDirectlyFromSupabase = useCallback(async (quiet = false): Promise<{
    success: boolean;
    connectionFailed?: boolean;
    schemaMissing?: boolean;
  }> => {
    setIsSyncing(true);
    try {
      const initRes = await initializeDefaultSupabaseDataIfEmpty(AUTO_CLOUD_OWNER_ID);
      if (initRes.schemaMissing) {
        setSupabaseSchemaMissing(true);
        supabaseSchemaMissingRef.current = true;
        setSupabaseConnectionStatus('schema_missing');
        supabaseConnectionStatusRef.current = 'schema_missing';
        if (!quiet) {
          showToast(
            'Supabase ยังไม่ได้รัน SQL สร้างตาราง (setup.sql) — กรุณากด "คัดลอก SQL สร้างตาราง" ด้านบนแล้วนำไปรันใน Supabase SQL Editor',
            'warning'
          );
        }
        return { success: false, connectionFailed: true, schemaMissing: true };
      }

      const data = await fetchCloudDataFromSupabase(AUTO_CLOUD_OWNER_ID, firebaseAuthUser?.uid);
      if (data.schemaMissing) {
        setSupabaseSchemaMissing(true);
        supabaseSchemaMissingRef.current = true;
        setSupabaseConnectionStatus('schema_missing');
        supabaseConnectionStatusRef.current = 'schema_missing';
        if (!quiet) {
          showToast(
            'Supabase ยังไม่ได้รัน SQL สร้างตาราง (setup.sql) — กรุณากด "คัดลอก SQL สร้างตาราง" ด้านบนแล้วนำไปรันใน Supabase SQL Editor',
            'warning'
          );
        }
        return { success: false, connectionFailed: true, schemaMissing: true };
      }

      if (data.connectionFailed) {
        setSupabaseConnectionStatus('disconnected');
        supabaseConnectionStatusRef.current = 'disconnected';
        if (!quiet) {
          showToast(
            `ไม่สามารถเชื่อมต่อ Supabase ได้ในขณะนี้: ${data.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต'}`,
            'error'
          );
        }
        return { success: false, connectionFailed: true };
      }

      setSupabaseSchemaMissing(false);
      supabaseSchemaMissingRef.current = false;
      setSupabaseConnectionStatus('connected');
      supabaseConnectionStatusRef.current = 'connected';
      setLastWriteMode('supabase_direct');

      const sortedStudents = [...data.students].sort((a, b) => a.seqNo - b.seqNo);
      const sortedParcels = [...data.parcels].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const loadedMembers = data.members.length > 0 ? data.members : INITIAL_MEMBERS;
      const loadedRoles =
        data.rolePermissions.length > 0 ? data.rolePermissions : INITIAL_ROLE_PERMISSIONS;
      const loadedRateConfig = data.rateLimitConfig || DEFAULT_PARCEL_RATE_LIMIT_CONFIG;

      setStudents(sortedStudents);
      setParcels(sortedParcels);
      setMembers(loadedMembers);
      setHasLoadedCloudMembers(true);
      setRolePermissions(loadedRoles);
      setParcelRateLimitConfig(loadedRateConfig);

      const nowIso = new Date().toISOString();
      lastRefreshTimeRef.current = Date.now();
      setLastConnectionCheckAt(nowIso);
      lastConnectionProbeTimeRef.current = Date.now();

      setQuotaMetrics((prev) => ({
        ...prev,
        supabaseReadsUsed: prev.supabaseReadsUsed + data.readsCount,
        lastSyncedAt: nowIso,
      }));

      return { success: true };
    } catch (err) {
      if (isSupabaseTableMissingError(err)) {
        setSupabaseSchemaMissing(true);
        supabaseSchemaMissingRef.current = true;
        setSupabaseConnectionStatus('schema_missing');
        supabaseConnectionStatusRef.current = 'schema_missing';
      } else {
        setSupabaseConnectionStatus('disconnected');
        supabaseConnectionStatusRef.current = 'disconnected';
      }
      if (!quiet) {
        showToast(
          `โหลดข้อมูลจาก Supabase ไม่สำเร็จ: ${err instanceof Error ? err.message : 'Error'}`,
          'error'
        );
      }
      return { success: false, connectionFailed: true };
    } finally {
      setIsSyncing(false);
    }
  }, [firebaseAuthUser?.uid, showToast]);

  // โหลดข้อมูลจาก Supabase โดยตรงทันทีเมื่อเปิดแอป
  useEffect(() => {
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    const bootstrapFromSupabase = async () => {
      await loadDataDirectlyFromSupabase(false);
      void checkSupabaseDetailedStatus().then((details) => setSupabaseConnectionDetails(details));
    };

    void bootstrapFromSupabase();
  }, [loadDataDirectlyFromSupabase]);

  // ซิงก์ข้อมูลล่าสุดจาก Supabase อัตโนมัติเมื่อหน้าต่างกลับมาโฟกัส (เว้นระยะอย่างน้อย 15 วินาที)
  useEffect(() => {
    const onFocus = () => {
      if (isUploadingRef.current) return;
      if (Date.now() - lastRefreshTimeRef.current < 15_000) return;
      void loadDataDirectlyFromSupabase(true);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [loadDataDirectlyFromSupabase]);

  // In-Memory Hash Map สำหรับค้นหาข้อมูลนักเรียนทันที
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
      setIsSyncing(true);
      try {
        const item: SupabaseWriteItem = {
          id: `system_settings:parcel_rate_limits:${Date.now()}`,
          collection: 'system_settings',
          docId: 'parcel_rate_limits',
          action: 'upsert',
          data: newConfig,
        };
        const writeRes = await commitWritesDirectlyToSupabase([item]);
        if (writeRes.mode === 'supabase_direct') {
          setParcelRateLimitConfig(newConfig);
          showToast('บันทึกการตั้งค่าอัตราการสั่งพัสดุลง Supabase โดยตรงสำเร็จ', 'success');
        } else {
          showToast(
            `ไม่สามารถบันทึกการตั้งค่าลง Supabase ได้: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
            'error'
          );
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [commitWritesDirectlyToSupabase, showToast]
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
   * ค้นหานักเรียนจากข้อมูลที่โหลดไว้ในหน่วยความจำก่อน หากไม่พบจึงค้นหาจาก Supabase โดยตรง
   */
  const lookupStudentWithCloudFallback = useCallback(
    async (
      code: string
    ): Promise<{ student: Student | undefined; source: 'memory' | 'supabase' | 'none' }> => {
      const localMatch = lookupStudentByCode(code);
      if (localMatch) {
        recordLocalSearchSaving();
        return { student: localMatch, source: 'memory' };
      }

      const clean = code.trim();
      if (!clean || supabaseSchemaMissingRef.current) {
        return { student: undefined, source: 'none' };
      }

      const fallbackRes = await findStudentInSupabaseFallback(clean);

      if (fallbackRes.readsCount > 0) {
        setQuotaMetrics((prev) => ({
          ...prev,
          supabaseReadsUsed: prev.supabaseReadsUsed + fallbackRes.readsCount,
        }));
      }

      if (fallbackRes.student) {
        const foundStudent = fallbackRes.student;
        const nextStudents = [
          foundStudent,
          ...studentsRef.current.filter((s) => s.studentCode !== foundStudent.studentCode),
        ].sort((a, b) => a.seqNo - b.seqNo);
        setStudents(nextStudents);
        return { student: foundStudent, source: 'supabase' };
      }

      return { student: undefined, source: 'none' };
    },
    [lookupStudentByCode, recordLocalSearchSaving]
  );

  /**
   * ค้นหาพัสดุจากข้อมูลที่โหลดไว้ในหน่วยความจำก่อน หากไม่พบจึงค้นหาจาก Supabase โดยตรง
   */
  const searchParcelsWithCloudFallback = useCallback(
    async (
      keyword: string,
      statusFilter = 'ALL',
      dormFilter = 'ALL',
      dateFilter = 'ALL'
    ): Promise<{ parcels: Parcel[]; source: 'memory' | 'supabase' }> => {
      const localResults = searchParcelsLocal(keyword, statusFilter, dormFilter, dateFilter);
      if (localResults.length > 0) {
        recordLocalSearchSaving();
        return { parcels: localResults, source: 'memory' };
      }

      const clean = keyword.trim();
      if (clean.length < 4 || supabaseSchemaMissingRef.current) {
        return { parcels: [], source: 'memory' };
      }

      const fallbackRes = await findParcelInSupabaseFallback(clean);

      if (fallbackRes.readsCount > 0) {
        setQuotaMetrics((prev) => ({
          ...prev,
          supabaseReadsUsed: prev.supabaseReadsUsed + fallbackRes.readsCount,
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

        const filteredCloud = fallbackRes.parcels.filter((p) => {
          if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
          if (dormFilter !== 'ALL' && p.dormitory !== dormFilter) return false;
          if (dateFilter !== 'ALL' && p.receivedDate !== dateFilter) return false;
          return true;
        });
        return { parcels: filteredCloud, source: 'supabase' };
      }

      return { parcels: [], source: 'supabase' };
    },
    [searchParcelsLocal, recordLocalSearchSaving]
  );

  // -----------------------------------------------------------------
  // การดำเนินการ บันทึก / แก้ไข / ลบ ลง Supabase โดยตรง
  // -----------------------------------------------------------------

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

      const item: SupabaseWriteItem = {
        id: `parcels:${trackingNumber}:${Date.now()}`,
        collection: 'parcels',
        docId: trackingNumber,
        action: 'upsert',
        data: newParcel,
      };

      const writeRes = await commitWritesDirectlyToSupabase([item]);
      if (writeRes.mode === 'supabase_direct') {
        const nextParcels = [
          newParcel,
          ...parcelsRef.current.filter((p) => (p.id || p.trackingNumber) !== trackingNumber),
        ];
        setParcels(nextParcels);
        showToast(
          `บันทึกพัสดุ ${newParcel.trackingNumber} ลงฐานข้อมูล Supabase โดยตรงสำเร็จ`,
          'success'
        );

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
      } else {
        showToast(
          `บันทึกพัสดุ ${newParcel.trackingNumber} ลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อฐานข้อมูล'}`,
          'error'
        );
      }

      return { ...newParcel, writeMode: writeRes.mode };
    },
    [
      lookupStudentByCode,
      getCurrentActorAttribution,
      commitWritesDirectlyToSupabase,
      openWeeklyWarningPopup,
      showToast,
      parcelRateLimitConfig,
    ]
  );

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

      const writeRes = await commitWritesDirectlyToSupabase([
        {
          id: `parcels:${parcelId}:${Date.now()}`,
          collection: 'parcels',
          docId: parcelId,
          action: 'upsert',
          data: updatedTarget,
        },
      ]);

      if (writeRes.mode === 'supabase_direct') {
        setParcels(nextParcels);
        showToast(
          `อัปเดตสถานะพัสดุ ${parcelId} เป็น "${newStatus}" ลง Supabase โดยตรงสำเร็จ`,
          'success'
        );
      } else {
        showToast(
          `อัปเดตสถานะพัสดุ ${parcelId} ลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
      }
    },
    [getCurrentActorAttribution, commitWritesDirectlyToSupabase, showToast]
  );

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

      const writeRes = await commitWritesDirectlyToSupabase([
        {
          id: `parcels:${parcelId}:${Date.now()}`,
          collection: 'parcels',
          docId: parcelId,
          action: 'upsert',
          data: updatedTarget,
        },
      ]);

      if (writeRes.mode === 'supabase_direct') {
        setParcels(nextParcels);
        showToast(`บันทึกการแก้ไขข้อมูลพัสดุ ${parcelId} ลง Supabase โดยตรงสำเร็จ`, 'success');
      } else {
        showToast(
          `แก้ไขข้อมูลพัสดุ ${parcelId} ลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
      }
    },
    [getCurrentActorAttribution, commitWritesDirectlyToSupabase, showToast]
  );

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
      const writeItems: SupabaseWriteItem[] = [];

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
          writeItems.push({
            id: `parcels:${key}:${Date.now()}`,
            collection: 'parcels',
            docId: key,
            action: 'upsert',
            data: updated,
          });
          return updated;
        }
        return p;
      });

      setIsSyncing(true);
      try {
        const writeRes = await commitWritesDirectlyToSupabase(writeItems, writeItems.length > 50);
        if (writeRes.mode === 'supabase_direct') {
          setParcels(nextParcels);
          showToast(
            `อัปเดตพัสดุ ${writeItems.length} รายการเป็น "${newStatus}" ลง Supabase โดยตรงสำเร็จ`,
            'success'
          );
        } else {
          showToast(
            `อัปเดตพัสดุลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
            'error'
          );
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [getCurrentActorAttribution, commitWritesDirectlyToSupabase, showToast]
  );

  const deleteParcel = useCallback(
    async (parcelId: string): Promise<void> => {
      const nextParcels = parcelsRef.current.filter(
        (p) => (p.id || p.trackingNumber) !== parcelId
      );

      const writeRes = await commitWritesDirectlyToSupabase([
        {
          id: `parcels:${parcelId}:${Date.now()}`,
          collection: 'parcels',
          docId: parcelId,
          action: 'delete',
        },
      ]);

      if (writeRes.mode === 'supabase_direct') {
        setParcels(nextParcels);
        showToast(`ลบรายการพัสดุ ${parcelId} ออกจากฐานข้อมูล Supabase โดยตรงแล้ว`, 'info');
      } else {
        showToast(
          `ลบรายการพัสดุ ${parcelId} ออกจาก Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
      }
    },
    [commitWritesDirectlyToSupabase, showToast]
  );

  const bulkDeleteParcels = useCallback(
    async (parcelIds: string[], reasonLabel?: string): Promise<number> => {
      if (parcelIds.length === 0) return 0;
      const targetSet = new Set(parcelIds);
      const nextParcels = parcelsRef.current.filter(
        (p) => !targetSet.has(p.id || p.trackingNumber)
      );

      const writeItems: SupabaseWriteItem[] = parcelIds.map((pid) => ({
        id: `parcels:${pid}:${Date.now()}`,
        collection: 'parcels',
        docId: pid,
        action: 'delete',
      }));

      setIsSyncing(true);
      try {
        const writeRes = await commitWritesDirectlyToSupabase(writeItems, writeItems.length > 50);
        if (writeRes.mode === 'supabase_direct') {
          setParcels(nextParcels);
          showToast(
            `ลบข้อมูลพัสดุ${reasonLabel ? ` (${reasonLabel})` : ''} จำนวน ${parcelIds.length} ชิ้น ออกจาก Supabase โดยตรงแล้ว`,
            'info'
          );
          return parcelIds.length;
        }
        showToast(
          `ลบข้อมูลพัสดุออกจาก Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
        return 0;
      } finally {
        setIsSyncing(false);
      }
    },
    [commitWritesDirectlyToSupabase, showToast]
  );

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

  const clearAllParcels = useCallback(async (): Promise<number> => {
    const allIds = parcelsRef.current.map((p) => p.id || p.trackingNumber);
    if (allIds.length === 0) {
      showToast('ไม่มีรายการพัสดุในระบบ', 'info');
      return 0;
    }
    return await bulkDeleteParcels(allIds, 'ทั้งหมดในระบบ');
  }, [bulkDeleteParcels, showToast]);

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

      const writeItems: SupabaseWriteItem[] = [];
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
        writeItems.push({
          id: `parcels:${id}:${Date.now()}`,
          collection: 'parcels',
          docId: id,
          action: 'upsert',
          data: parcelObj,
        });
      }

      const nextParcels = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setIsSyncing(true);
      try {
        const writeRes = await commitWritesDirectlyToSupabase(writeItems, writeItems.length > 50);
        if (writeRes.mode === 'supabase_direct') {
          setParcels(nextParcels);
          showToast(
            `นำเข้า/กู้คืนข้อมูลพัสดุ ${writeItems.length} รายการ ลง Supabase โดยตรงสำเร็จ`,
            'success'
          );
          return writeItems.length;
        }
        showToast(
          `นำเข้าข้อมูลพัสดุลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
        return 0;
      } finally {
        setIsSyncing(false);
      }
    },
    [getCurrentActorAttribution, commitWritesDirectlyToSupabase, showToast]
  );

  const fullRestoreSystemBackup = useCallback(
    async (
      backupData: { students?: Student[]; parcels?: Parcel[] },
      replaceAll = false
    ): Promise<{ studentsCount: number; parcelsCount: number }> => {
      const isoNow = new Date().toISOString();
      const writeItems: SupabaseWriteItem[] = [];

      let nextStudents = replaceAll ? [] : [...studentsRef.current];
      let nextParcels = replaceAll ? [] : [...parcelsRef.current];

      const incomingStudentCodes = new Set(
        (backupData.students || []).map((s) => formatStudentCode(s.studentCode)).filter(Boolean)
      );
      const incomingParcelIds = new Set(
        (backupData.parcels || []).map((p) => (p.trackingNumber || p.id || '').trim()).filter(Boolean)
      );

      if (replaceAll) {
        for (const p of parcelsRef.current) {
          const pid = (p.id || p.trackingNumber || '').trim();
          if (pid && !incomingParcelIds.has(pid)) {
            writeItems.push({
              id: `parcels:${pid}:${Date.now()}`,
              collection: 'parcels',
              docId: pid,
              action: 'delete',
            });
          }
        }
        for (const s of studentsRef.current) {
          if (s.studentCode && !incomingStudentCodes.has(s.studentCode)) {
            writeItems.push({
              id: `students:${s.studentCode}:${Date.now()}`,
              collection: 'students',
              docId: s.studentCode,
              action: 'delete',
            });
          }
        }
      }

      let studentsCount = 0;
      let parcelsCount = 0;

      if (backupData.students && backupData.students.length > 0) {
        const sMap = new Map<string, Student>();
        for (const s of nextStudents) sMap.set(s.studentCode, s);
        for (const s of backupData.students) {
          const code = formatStudentCode(s.studentCode);
          if (!code) continue;
          const studentObj: Student = {
            ...s,
            studentCode: code,
            ownerId: AUTO_CLOUD_OWNER_ID,
            createdAt: s.createdAt || isoNow,
            updatedAt: isoNow,
          };
          sMap.set(code, studentObj);
          writeItems.push({
            id: `students:${code}:${Date.now()}`,
            collection: 'students',
            docId: code,
            action: 'upsert',
            data: studentObj,
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
          writeItems.push({
            id: `parcels:${pid}:${Date.now()}`,
            collection: 'parcels',
            docId: pid,
            action: 'upsert',
            data: parcelObj,
          });
          parcelsCount++;
        }
        nextParcels = Array.from(pMap.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }

      setIsSyncing(true);
      try {
        const writeRes = await commitWritesDirectlyToSupabase(writeItems, true);
        if (writeRes.mode === 'supabase_direct') {
          setStudents(nextStudents);
          setParcels(nextParcels);
          showToast(
            `กู้คืนข้อมูลลง Supabase โดยตรงสำเร็จ: นักเรียน ${studentsCount} คน, พัสดุ ${parcelsCount} รายการ`,
            'success'
          );
          return { studentsCount, parcelsCount };
        }
        showToast(
          `กู้คืนข้อมูลลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
        return { studentsCount: 0, parcelsCount: 0 };
      } finally {
        setIsSyncing(false);
      }
    },
    [getCurrentActorAttribution, commitWritesDirectlyToSupabase, showToast]
  );

  const bulkImportStudents = useCallback(
    async (
      rawStudents: Omit<Student, 'ownerId' | 'createdAt' | 'updatedAt'>[]
    ): Promise<number> => {
      if (rawStudents.length === 0) return 0;
      const isoNow = new Date().toISOString();
      const sMap = new Map<string, Student>();
      for (const s of studentsRef.current) sMap.set(s.studentCode, s);

      const writeItems: SupabaseWriteItem[] = [];
      for (const s of rawStudents) {
        const code = formatStudentCode(s.studentCode);
        if (!code) continue;
        const studentObj: Student = {
          ...s,
          studentCode: code,
          ownerId: AUTO_CLOUD_OWNER_ID,
          createdAt: isoNow,
          updatedAt: isoNow,
        };
        sMap.set(code, studentObj);
        writeItems.push({
          id: `students:${code}:${Date.now()}`,
          collection: 'students',
          docId: code,
          action: 'upsert',
          data: studentObj,
        });
      }

      const nextStudents = Array.from(sMap.values()).sort((a, b) => a.seqNo - b.seqNo);

      setIsSyncing(true);
      try {
        const writeRes = await commitWritesDirectlyToSupabase(writeItems, writeItems.length > 50);
        if (writeRes.mode === 'supabase_direct') {
          setStudents(nextStudents);
          showToast(
            `นำเข้ารายชื่อนักเรียน ${rawStudents.length} คน ลงฐานข้อมูล Supabase โดยตรงสำเร็จ (รวม ${nextStudents.length} คน)`,
            'success'
          );
          return rawStudents.length;
        }
        showToast(
          `นำเข้ารายชื่อนักเรียนลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
        return 0;
      } finally {
        setIsSyncing(false);
      }
    },
    [commitWritesDirectlyToSupabase, showToast]
  );

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

      const writeRes = await commitWritesDirectlyToSupabase([
        {
          id: `students:${code}:${Date.now()}`,
          collection: 'students',
          docId: code,
          action: 'upsert',
          data: studentObj,
        },
      ]);

      if (writeRes.mode === 'supabase_direct') {
        setStudents(nextStudents);
        showToast(`บันทึกข้อมูลนักเรียนรหัส ${code} ลงฐานข้อมูล Supabase โดยตรงสำเร็จ`, 'success');
      } else {
        showToast(
          `บันทึกข้อมูลนักเรียนรหัส ${code} ลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
      }
    },
    [commitWritesDirectlyToSupabase, showToast]
  );

  const deleteStudent = useCallback(
    async (studentCode: string): Promise<void> => {
      const code = formatStudentCode(studentCode);
      const nextStudents = studentsRef.current.filter(
        (s) => s.studentCode !== code && s.studentCode !== studentCode
      );

      const writeRes = await commitWritesDirectlyToSupabase([
        {
          id: `students:${code}:${Date.now()}`,
          collection: 'students',
          docId: code,
          action: 'delete',
        },
      ]);

      if (writeRes.mode === 'supabase_direct') {
        setStudents(nextStudents);
        showToast(`ลบข้อมูลนักเรียนรหัส ${code} ออกจาก Supabase โดยตรงแล้ว`, 'info');
      } else {
        showToast(
          `ลบข้อมูลนักเรียนรหัส ${code} ออกจาก Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
      }
    },
    [commitWritesDirectlyToSupabase, showToast]
  );

  const bulkDeleteStudents = useCallback(
    async (studentCodes: string[], targetLabel?: string): Promise<void> => {
      if (studentCodes.length === 0) return;
      const targetSet = new Set(studentCodes.map((c) => formatStudentCode(c)));
      const nextStudents = studentsRef.current.filter(
        (s) => !targetSet.has(s.studentCode) && !studentCodes.includes(s.studentCode)
      );

      const writeItems: SupabaseWriteItem[] = studentCodes.map((c) => {
        const code = formatStudentCode(c);
        return {
          id: `students:${code}:${Date.now()}`,
          collection: 'students',
          docId: code,
          action: 'delete',
        };
      });

      setIsSyncing(true);
      try {
        const writeRes = await commitWritesDirectlyToSupabase(writeItems, writeItems.length > 50);
        if (writeRes.mode === 'supabase_direct') {
          setStudents(nextStudents);
          showToast(
            `ลบข้อมูลนักเรียน${targetLabel ? ` (${targetLabel})` : ''} จำนวน ${studentCodes.length} คน ออกจาก Supabase โดยตรงสำเร็จ`,
            'info'
          );
        } else {
          showToast(
            `ลบข้อมูลนักเรียนออกจาก Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
            'error'
          );
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [commitWritesDirectlyToSupabase, showToast]
  );

  const clearAllStudents = useCallback(async () => {
    const allCodes = studentsRef.current.map((s) => s.studentCode);
    if (allCodes.length === 0) {
      showToast('ไม่มีข้อมูลนักเรียนในระบบ', 'info');
      return;
    }
    await bulkDeleteStudents(allCodes, 'ทั้งหมดในระบบ');
  }, [bulkDeleteStudents, showToast]);

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

      const writeRes = await commitWritesDirectlyToSupabase([
        {
          id: `members:${generatedId}:${Date.now()}`,
          collection: 'members',
          docId: generatedId,
          action: 'upsert',
          data: memberObj,
        },
      ]);

      if (writeRes.mode === 'supabase_direct') {
        setMembers(nextMembers);
        showToast(
          `${isExisting ? 'แก้ไขข้อมูล' : 'เพิ่ม'}สมาชิก "${memberObj.fullName}" (${memberObj.role}) ลง Supabase โดยตรงสำเร็จ`,
          'success'
        );
      } else {
        showToast(
          `บันทึกสมาชิก "${memberObj.fullName}" ลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
      }
      return memberObj;
    },
    [commitWritesDirectlyToSupabase, showToast]
  );

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
      const writeRes = await commitWritesDirectlyToSupabase([
        {
          id: `members:${memberId}:${Date.now()}`,
          collection: 'members',
          docId: memberId,
          action: 'delete',
        },
      ]);

      if (writeRes.mode === 'supabase_direct') {
        setMembers(nextMembers);
        if (currentMemberId === memberId) {
          setCurrentMemberId(null);
          setSessionMemberSnapshot(null);
          clearStoredLoginSession();
        }
        showToast(`ลบสมาชิก "${target.fullName}" ออกจาก Supabase โดยตรงแล้ว`, 'info');
      } else {
        showToast(
          `ลบสมาชิก "${target.fullName}" ออกจาก Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
      }
    },
    [currentMemberId, commitWritesDirectlyToSupabase, showToast]
  );

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

      const writeRes = await commitWritesDirectlyToSupabase([
        {
          id: `role_permissions:${roleId}:${Date.now()}`,
          collection: 'role_permissions',
          docId: roleId,
          action: 'upsert',
          data: updatedRole,
        },
      ]);

      if (writeRes.mode === 'supabase_direct') {
        setRolePermissions(nextRoles);
        showToast(`บันทึกสิทธิ์ของระดับ "${updatedRole.roleName}" ลง Supabase โดยตรงสำเร็จ`, 'success');
      } else {
        showToast(
          `บันทึกสิทธิ์ของระดับ "${updatedRole.roleName}" ลง Supabase ไม่สำเร็จ: ${writeRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
      }
    },
    [commitWritesDirectlyToSupabase, showToast]
  );

  // คำนวณสิทธิ์เมนูที่สมาชิกแต่ละคนมีสิทธิ์เข้าถึง
  const getEffectiveMemberMenus = useCallback(
    (member: Member): AppMenuKey[] => {
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
    if (found) {
      return found.active ? found : null;
    }
    if (
      !hasLoadedCloudMembers &&
      sessionMemberSnapshot &&
      sessionMemberSnapshot.memberId === currentMemberId
    ) {
      return sessionMemberSnapshot.active ? sessionMemberSnapshot : null;
    }
    return null;
  }, [currentMemberId, members, hasLoadedCloudMembers, sessionMemberSnapshot]);

  // ซิงก์ข้อมูลสมาชิกที่ล็อกอินกับ sessionStorage และตรวจสอบสถานะล่าสุดหลังโหลดจากฐานข้อมูล
  useEffect(() => {
    if (!currentMemberId) return;
    const found = members.find((m) => m.memberId === currentMemberId);
    if (found) {
      if (!found.active) {
        setCurrentMemberId(null);
        setSessionMemberSnapshot(null);
        clearStoredLoginSession();
      } else {
        writeStoredLoginSession(found);
      }
    } else if (hasLoadedCloudMembers) {
      setCurrentMemberId(null);
      setSessionMemberSnapshot(null);
      clearStoredLoginSession();
    }
  }, [currentMemberId, members, hasLoadedCloudMembers]);

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
      setSessionMemberSnapshot({ ...matched, password: '' });
      writeStoredLoginSession(matched);
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
        setSessionMemberSnapshot({ ...matched, password: '' });
        writeStoredLoginSession(matched);
        showToast(`เข้าสู่ระบบด้วย Google สำเร็จ: ${matched.fullName} (${matched.role})`, 'success');
        return { success: true, message: 'เข้าสู่ระบบสำเร็จ' };
      }

      const fallbackAdmin = members.find((m) => m.role === 'ผู้ดูแลระบบ' && m.active) || members[0];
      if (fallbackAdmin) {
        setCurrentMemberId(fallbackAdmin.memberId);
        setSessionMemberSnapshot({ ...fallbackAdmin, password: '' });
        writeStoredLoginSession(fallbackAdmin);
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
    setSessionMemberSnapshot(null);
    clearStoredLoginSession();
    void signOutFirebaseUser().catch(() => {});
    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
  }, [showToast]);

  // สรุปยอดพัสดุในฐานข้อมูล Supabase แยกตามผู้ใช้งาน
  const supabaseParcelSummary = useMemo<SupabaseParcelSummary>(() => {
    const todayYMD = getRelativeDateString(0);
    const memberById = new Map<string, Member>();
    for (const m of members) {
      memberById.set(m.memberId, m);
    }

    const userStatsMap = new Map<string, UserParcelStat>();
    const ensureUserStat = (
      userKey: string,
      userName: string,
      userRole: string
    ): UserParcelStat => {
      let existing = userStatsMap.get(userKey);
      if (!existing) {
        const matchedMember = memberById.get(userKey);
        existing = {
          userKey,
          userName: matchedMember?.fullName || userName || 'ผู้ใช้งานระบบ',
          userRole: matchedMember?.role || userRole || 'ระบบ',
          totalParcels: 0,
          todayParcels: 0,
          lastRecordedAt: null,
        };
        userStatsMap.set(userKey, existing);
      }
      return existing;
    };

    let todayParcels = 0;
    for (const p of parcels) {
      const pYmd = p.receivedDate || extractParcelLocalYMD(p);
      const isToday = pYmd === todayYMD;
      if (isToday) todayParcels++;

      const userKey = p.recordedByMemberId || 'shared_system';
      const userName = p.recordedByName || 'ระบบกลาง / ไม่ระบุผู้บันทึก';
      const userRole = p.recordedByRole || 'ระบบ';

      const stat = ensureUserStat(userKey, userName, userRole);
      stat.totalParcels++;
      if (isToday) stat.todayParcels++;

      const ts = p.updatedAt || p.createdAt;
      if (ts && (!stat.lastRecordedAt || ts > stat.lastRecordedAt)) {
        stat.lastRecordedAt = ts;
      }
    }

    const byUser = Array.from(userStatsMap.values()).sort(
      (a, b) =>
        b.totalParcels - a.totalParcels ||
        b.todayParcels - a.todayParcels ||
        a.userName.localeCompare(b.userName, 'th')
    );

    return {
      totalParcels: parcels.length,
      todayParcels,
      byUser,
    };
  }, [parcels, members]);

  const refreshFromSupabase = useCallback(async (): Promise<void> => {
    const res = await loadDataDirectlyFromSupabase(false);
    if (res.success) {
      void checkSupabaseDetailedStatus().then((details) => setSupabaseConnectionDetails(details));
      showToast(
        `ดึงข้อมูลล่าสุดจาก Supabase สำเร็จ (นักเรียน ${studentsRef.current.length} คน · พัสดุ ${parcelsRef.current.length} ชิ้น)`,
        'success'
      );
    }
  }, [loadDataDirectlyFromSupabase, showToast]);

  const signInGoogle = useCallback(async () => {
    try {
      const loggedInUser = await signInWithGooglePopup();
      showToast(`ยืนยันตัวตนบัญชี Google สำเร็จ: ${loggedInUser.email || AUTO_CLOUD_EMAIL}`, 'success');
      await loadDataDirectlyFromSupabase(false);
    } catch {
      showToast(`ระบบเชื่อมต่ออัตโนมัติภายใต้บัญชี ${AUTO_CLOUD_EMAIL}`, 'success');
    }
  }, [showToast, loadDataDirectlyFromSupabase]);

  const signOutUser = useCallback(async () => {
    await signOutFirebaseUser();
    showToast(`ออกจากบัญชี Google (ยังคงทำงานกับฐานข้อมูลหลัก ${AUTO_CLOUD_EMAIL})`, 'info');
  }, [showToast]);

  const copySupabaseSetupSql = useCallback(async (): Promise<boolean> => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = SUPABASE_SETUP_SQL;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast(
        'คัดลอก SQL สร้างตาราง Supabase (setup.sql) แล้ว — วางใน Supabase SQL Editor แล้วกด Run ครั้งเดียว',
        'success'
      );
      return true;
    } catch {
      showToast('ไม่สามารถคัดลอกอัตโนมัติได้ กรุณาคัดลอกจากไฟล์ supabase/setup.sql', 'error');
      return false;
    }
  }, [showToast]);

  // ย้ายข้อมูลจาก Firestore เดิม (ถ้ามี) และตั้งค่าเริ่มต้นเข้าสู่ Supabase โดยตรง
  const migrateAllDataToSupabase = useCallback(async (): Promise<void> => {
    if (isUploadingRef.current) return;
    isUploadingRef.current = true;
    setIsSyncing(true);

    try {
      const status = await checkAndSyncConnectionStatus(true);
      if (status.schemaMissing) {
        showToast(
          'ยังไม่ได้สร้างตารางใน Supabase — กรุณากด "คัดลอก SQL สร้างตาราง" แล้วนำไปวางใน Supabase SQL Editor กด Run ก่อน 1 ครั้ง',
          'warning'
        );
        return;
      }
      if (status.connectionFailed) {
        showToast(
          'ไม่สามารถเชื่อมต่อ Supabase ได้ในขณะนี้ กรุณาตรวจสอบอินเทอร์เน็ตหรือค่า SUPABASE_URL',
          'error'
        );
        return;
      }

      let legacyStudents: Student[] = [];
      let legacyParcels: Parcel[] = [];
      let legacyMembers: Member[] = [];
      let legacyRolePerms: RolePermission[] = [];
      let legacyRateConfig: ParcelRateLimitConfig | null = null;
      let firestoreReadOk = false;

      try {
        const legacy = await fetchLegacyFirestoreDataDirectly(
          AUTO_CLOUD_OWNER_ID,
          firebaseAuthUser?.uid
        );
        if (!legacy.quotaExceeded && !legacy.connectionFailed) {
          firestoreReadOk = true;
          legacyStudents = legacy.students;
          legacyParcels = legacy.parcels;
          legacyMembers = legacy.members;
          legacyRolePerms = legacy.rolePermissions;
          legacyRateConfig = legacy.rateLimitConfig;
        }
      } catch {
        // ignore if legacy Firestore is unavailable
      }

      const studentMapMerged = new Map<string, Student>();
      const parcelMapMerged = new Map<string, Parcel>();
      const memberMapMerged = new Map<string, Member>();
      const rolePermMapMerged = new Map<string, RolePermission>();

      const addStudent = (s: Student) => {
        const code = formatStudentCode(s.studentCode);
        if (!code) return;
        studentMapMerged.set(code, { ...s, studentCode: code, ownerId: AUTO_CLOUD_OWNER_ID });
      };
      const addParcel = (p: Parcel) => {
        const key = (p.trackingNumber || p.id || '').trim();
        if (!key) return;
        parcelMapMerged.set(key, { ...p, id: key, trackingNumber: key, ownerId: AUTO_CLOUD_OWNER_ID });
      };
      const addMember = (m: Member) => {
        if (!m.memberId) return;
        memberMapMerged.set(m.memberId, { ...m, ownerId: AUTO_CLOUD_OWNER_ID });
      };
      const addRolePerm = (rp: RolePermission) => {
        if (!rp.roleId) return;
        rolePermMapMerged.set(rp.roleId, { ...rp, ownerId: AUTO_CLOUD_OWNER_ID });
      };

      INITIAL_MEMBERS.forEach(addMember);
      INITIAL_ROLE_PERMISSIONS.forEach(addRolePerm);

      legacyStudents.forEach(addStudent);
      legacyParcels.forEach(addParcel);
      legacyMembers.forEach(addMember);
      legacyRolePerms.forEach(addRolePerm);

      studentsRef.current.forEach(addStudent);
      parcelsRef.current.forEach(addParcel);
      membersRef.current.forEach(addMember);
      rolePermissionsRef.current.forEach(addRolePerm);

      await initializeDefaultSupabaseDataIfEmpty(AUTO_CLOUD_OWNER_ID);

      const migrationItems: SupabaseWriteItem[] = [
        ...Array.from(rolePermMapMerged.values()).map((rp) => ({
          id: `migrate:role_permissions:${rp.roleId}:${Date.now()}`,
          collection: 'role_permissions' as const,
          docId: rp.roleId,
          action: 'upsert' as const,
          data: rp,
        })),
        ...Array.from(memberMapMerged.values()).map((m) => ({
          id: `migrate:members:${m.memberId}:${Date.now()}`,
          collection: 'members' as const,
          docId: m.memberId,
          action: 'upsert' as const,
          data: m,
        })),
        ...Array.from(studentMapMerged.values()).map((st) => ({
          id: `migrate:students:${st.studentCode}:${Date.now()}`,
          collection: 'students' as const,
          docId: st.studentCode,
          action: 'upsert' as const,
          data: st,
        })),
        ...Array.from(parcelMapMerged.values()).map((p) => ({
          id: `migrate:parcels:${p.id || p.trackingNumber}:${Date.now()}`,
          collection: 'parcels' as const,
          docId: p.id || p.trackingNumber,
          action: 'upsert' as const,
          data: p,
        })),
        {
          id: `migrate:system_settings:parcel_rate_limits:${Date.now()}`,
          collection: 'system_settings' as const,
          docId: 'parcel_rate_limits',
          action: 'upsert' as const,
          data: rateLimitRef.current || legacyRateConfig || DEFAULT_PARCEL_RATE_LIMIT_CONFIG,
        },
      ];

      const uploadRes = await commitWritesDirectlyToSupabase(migrationItems, true);
      if (uploadRes.mode !== 'supabase_direct') {
        showToast(
          `ย้ายข้อมูลเข้า Supabase ไม่สำเร็จ: ${uploadRes.errorMessage || 'กรุณาตรวจสอบการเชื่อมต่อ'}`,
          'error'
        );
        return;
      }

      await loadDataDirectlyFromSupabase(true);
      void checkSupabaseDetailedStatus().then((details) => setSupabaseConnectionDetails(details));

      showToast(
        `เชื่อมต่อและซิงก์ข้อมูลเข้า Supabase สำเร็จ! (${
          firestoreReadOk ? 'รวมข้อมูลจาก Firestore เดิม + ปัจจุบัน' : 'ซิงก์ฐานข้อมูล Supabase'
        }: นักเรียน ${studentsRef.current.length} คน · พัสดุ ${parcelsRef.current.length} ชิ้น · สมาชิก ${membersRef.current.length} คน)`,
        'success'
      );
    } catch (err) {
      showToast(
        `เกิดข้อผิดพลาดระหว่างเชื่อมต่อ Supabase: ${
          err instanceof Error ? err.message : 'Error'
        }`,
        'error'
      );
    } finally {
      isUploadingRef.current = false;
      setIsSyncing(false);
      setSyncProgress(null);
    }
  }, [checkAndSyncConnectionStatus, commitWritesDirectlyToSupabase, firebaseAuthUser?.uid, loadDataDirectlyFromSupabase, showToast]);

  const refreshSupabaseConnectionStatus = useCallback(
    async (showToastNotification = false): Promise<SupabaseConnectionDetails> => {
      setIsCheckingSupabaseStatus(true);
      try {
        const details = await checkSupabaseDetailedStatus();
        setSupabaseConnectionDetails(details);
        setLastConnectionCheckAt(details.checkedAt);
        lastConnectionProbeTimeRef.current = Date.now();

        if (!details.connected) {
          setSupabaseSchemaMissing(false);
          supabaseSchemaMissingRef.current = false;
          setSupabaseConnectionStatus('disconnected');
          supabaseConnectionStatusRef.current = 'disconnected';
          setLastWriteMode('supabase_error');
          if (showToastNotification) {
            showToast(
              `ไม่สามารถเชื่อมต่อ Supabase (${details.projectRef}) ได้ในขณะนี้ (${details.latencyMs} ms)`,
              'warning'
            );
          }
        } else if (!details.schemaReady) {
          setSupabaseSchemaMissing(true);
          supabaseSchemaMissingRef.current = true;
          setSupabaseConnectionStatus('schema_missing');
          supabaseConnectionStatusRef.current = 'schema_missing';
          setLastWriteMode('supabase_error');
          if (showToastNotification) {
            showToast(
              'เชื่อมต่อ Supabase สำเร็จ แต่ยังสร้างตารางไม่ครบ 5 ตาราง (กรุณารัน setup.sql)',
              'warning'
            );
          }
        } else {
          setSupabaseSchemaMissing(false);
          supabaseSchemaMissingRef.current = false;
          setSupabaseConnectionStatus('connected');
          supabaseConnectionStatusRef.current = 'connected';
          setLastWriteMode('supabase_direct');
          if (showToastNotification) {
            const stCount = details.tables.find((t) => t.table === 'students')?.count ?? 0;
            const pCount = details.tables.find((t) => t.table === 'parcels')?.count ?? 0;
            showToast(
              `เชื่อมต่อ Supabase (${details.projectRef}) สำเร็จ · ${details.latencyMs} ms · นักเรียน ${stCount} คน / พัสดุ ${pCount} ชิ้น`,
              'success'
            );
          }
        }
        return details;
      } finally {
        setIsCheckingSupabaseStatus(false);
      }
    },
    [showToast]
  );

  const recheckSupabaseStatus = useCallback(async (): Promise<SupabaseStatusCheck> => {
    const [status, details] = await Promise.all([
      checkAndSyncConnectionStatus(true),
      checkSupabaseDetailedStatus(),
    ]);
    setSupabaseConnectionDetails(details);
    if (status.available) {
      showToast(
        `Supabase พร้อมใช้งานแล้ว (${details.latencyMs} ms) — บันทึกข้อมูลลงฐานข้อมูล Supabase โดยตรงทันที`,
        'success'
      );
    } else if (status.schemaMissing) {
      showToast(
        'ยังไม่ได้สร้างตารางใน Supabase (setup.sql) — กรุณากด "คัดลอก SQL สร้างตาราง" แล้วนำไปวางและกด Run ใน Supabase SQL Editor',
        'warning'
      );
    } else {
      showToast('ยังไม่สามารถเชื่อมต่อ Supabase ได้ในขณะนี้', 'error');
    }
    return status;
  }, [checkAndSyncConnectionStatus, showToast]);

  const exportParcelsJson = useCallback(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}`;

    const payload = {
      meta: {
        system: 'Student Parcel Management & Tracking System',
        source: 'Supabase',
        exportedAt: now.toISOString(),
        parcelsCount: parcelsRef.current.length,
        studentsCount: studentsRef.current.length,
      },
      students: studentsRef.current,
      parcels: parcelsRef.current,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SPMS_SUPABASE_EXPORT_${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(
      `ส่งออกไฟล์ JSON จาก Supabase สำเร็จ (พัสดุ ${parcelsRef.current.length} ชิ้น, นักเรียน ${studentsRef.current.length} คน)`,
      'success'
    );
  }, [showToast]);

  const exportParcelsCsv = useCallback(() => {
    const exportParcels = parcelsRef.current;
    if (exportParcels.length === 0) {
      showToast('ยังไม่มีข้อมูลพัสดุในฐานข้อมูล Supabase สำหรับส่งออก', 'warning');
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
    link.download = `SPMS_SUPABASE_PARCELS_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`ส่งออกไฟล์ CSV สำเร็จ (${exportParcels.length} รายการ)`, 'success');
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
      supabaseParcelSummary,
      supabaseConnectionStatus,
      lastConnectionCheckAt,
      lastWriteMode,
      quotaMetrics,
      isSyncing,
      supabaseSchemaMissing,
      supabaseConnectionDetails,
      isCheckingSupabaseStatus,
      syncProgress,
      toastMessage,
      clearToast,
      recheckSupabaseStatus,
      refreshSupabaseConnectionStatus,
      copySupabaseSetupSql,
      migrateAllDataToSupabase,
      exportParcelsJson,
      exportParcelsCsv,
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
      refreshFromSupabase,
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
      supabaseParcelSummary,
      supabaseConnectionStatus,
      lastConnectionCheckAt,
      lastWriteMode,
      quotaMetrics,
      isSyncing,
      supabaseSchemaMissing,
      supabaseConnectionDetails,
      isCheckingSupabaseStatus,
      syncProgress,
      toastMessage,
      clearToast,
      recheckSupabaseStatus,
      refreshSupabaseConnectionStatus,
      copySupabaseSetupSql,
      migrateAllDataToSupabase,
      exportParcelsJson,
      exportParcelsCsv,
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
      refreshFromSupabase,
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
