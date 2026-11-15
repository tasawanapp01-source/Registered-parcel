import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Student,
  Parcel,
  ParcelStatus,
  Member,
  MemberRole,
  RolePermission,
  AppMenuKey,
  ALL_MENU_KEYS,
  SupabaseWriteItem,
  INITIAL_MEMBERS,
  INITIAL_ROLE_PERMISSIONS,
  INITIAL_STUDENTS,
  INITIAL_PARCELS,
  ParcelRateLimitConfig,
  DEFAULT_PARCEL_RATE_LIMIT_CONFIG,
  SupabaseStatusCheck,
  formatStudentCode,
  getRelativeDateString,
} from '../types/parcel';

export const AUTO_CLOUD_EMAIL = 'Tasawan_app01@pcccr.ac.th';
export const AUTO_CLOUD_OWNER_ID = 'tasawan_app01_pcccr_ac_th';

// ใช้เฉพาะ Publishable Key (Public Client Key) ตามมาตรฐานความปลอดภัยของ Supabase
const DEFAULT_SUPABASE_URL = 'https://dfzucqnxvncbfnmtugcd.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_7ItOEOro10cg2SBlK1RFHg_eV166am5';

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const SUPABASE_PROJECT_REF = (() => {
  try {
    const hostname = new URL(SUPABASE_URL).hostname;
    return hostname.split('.')[0] || 'dfzucqnxvncbfnmtugcd';
  } catch {
    return 'dfzucqnxvncbfnmtugcd';
  }
})();

export const SUPABASE_SQL_EDITOR_URL = `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/sql/new`;
export const SUPABASE_DASHBOARD_URL = `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/editor`;

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export const SUPABASE_SETUP_SQL = `-- Student Parcel Management & Tracking System (Supabase PostgreSQL)
CREATE TABLE IF NOT EXISTS public.students (
  student_code TEXT PRIMARY KEY,
  seq_no INTEGER NOT NULL DEFAULT 1,
  prefix TEXT NOT NULL DEFAULT '-',
  first_name TEXT NOT NULL DEFAULT '-',
  last_name TEXT NOT NULL DEFAULT '-',
  nickname TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '-',
  room TEXT NOT NULL DEFAULT '-',
  dormitory TEXT NOT NULL DEFAULT '-',
  dorm_room TEXT NOT NULL DEFAULT '-',
  bed TEXT NOT NULL DEFAULT '-',
  owner_id TEXT NOT NULL DEFAULT 'tasawan_app01_pcccr_ac_th',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.parcels (
  tracking_number TEXT PRIMARY KEY,
  student_code TEXT NOT NULL DEFAULT 'UNKNOWN',
  student_full_name TEXT NOT NULL DEFAULT '-',
  nickname TEXT NOT NULL DEFAULT '',
  grade_room TEXT NOT NULL DEFAULT '-',
  dormitory TEXT NOT NULL DEFAULT 'ไม่ระบุหอ',
  dorm_room TEXT NOT NULL DEFAULT '-',
  bed TEXT NOT NULL DEFAULT '-',
  category TEXT NOT NULL DEFAULT 'อื่นๆ',
  status TEXT NOT NULL DEFAULT 'ลงทะเบียนรับพัสดุ',
  courier TEXT NOT NULL DEFAULT 'Flash Express',
  note TEXT NOT NULL DEFAULT '',
  is_six_digits_input BOOLEAN NOT NULL DEFAULT FALSE,
  received_date TEXT NOT NULL DEFAULT '',
  received_hour INTEGER NOT NULL DEFAULT 12,
  delivered_date TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT 'tasawan_app01_pcccr_ac_th',
  recorded_by_member_id TEXT NOT NULL DEFAULT '',
  recorded_by_name TEXT NOT NULL DEFAULT '',
  recorded_by_role TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parcels_student_code ON public.parcels (student_code);
CREATE INDEX IF NOT EXISTS idx_parcels_received_date ON public.parcels (received_date);
CREATE INDEX IF NOT EXISTS idx_parcels_created_at ON public.parcels (created_at DESC);

CREATE TABLE IF NOT EXISTS public.members (
  member_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'เจ้าหน้าที่',
  allowed_menus JSONB NOT NULL DEFAULT '[]'::jsonb,
  use_custom_menus BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT TRUE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  owner_id TEXT NOT NULL DEFAULT 'tasawan_app01_pcccr_ac_th',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id TEXT PRIMARY KEY,
  role_name TEXT NOT NULL,
  allowed_menus JSONB NOT NULL DEFAULT '[]'::jsonb,
  can_edit BOOLEAN NOT NULL DEFAULT TRUE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id TEXT NOT NULL DEFAULT 'tasawan_app01_pcccr_ac_th',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
  setting_id TEXT PRIMARY KEY,
  daily_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  daily_limit INTEGER NOT NULL DEFAULT 1,
  weekly_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_limit INTEGER NOT NULL DEFAULT 3,
  monthly_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_limit INTEGER NOT NULL DEFAULT 10,
  owner_id TEXT NOT NULL DEFAULT 'tasawan_app01_pcccr_ac_th',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spms_students_all" ON public.students;
CREATE POLICY "spms_students_all" ON public.students FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "spms_parcels_all" ON public.parcels;
CREATE POLICY "spms_parcels_all" ON public.parcels FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "spms_members_all" ON public.members;
CREATE POLICY "spms_members_all" ON public.members FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "spms_role_permissions_all" ON public.role_permissions;
CREATE POLICY "spms_role_permissions_all" ON public.role_permissions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "spms_system_settings_all" ON public.system_settings;
CREATE POLICY "spms_system_settings_all" ON public.system_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';`;

export function sanitizeId(raw: string, maxLen = 64): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '');
  return (cleaned || 'ID001').slice(0, maxLen);
}

function sanitizeString(
  raw: string | undefined | null,
  minLen: number,
  maxLen: number,
  fallback = '-'
): string {
  const val = String(raw ?? '').trim();
  if (val.length < minLen) {
    return fallback.slice(0, maxLen);
  }
  return val.slice(0, maxLen);
}

function sanitizeMenuList(menus: unknown): AppMenuKey[] {
  const validSet = new Set<string>(ALL_MENU_KEYS);
  if (!Array.isArray(menus)) return [];
  return Array.from(
    new Set(
      menus.filter((m): m is AppMenuKey => typeof m === 'string' && validSet.has(m))
    )
  ).slice(0, 20);
}

export function isSupabaseTableMissingError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '').toUpperCase()
      : '';
  const msg = (
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : error instanceof Error
      ? error.message
      : String(error || '')
  ).toLowerCase();

  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    msg.includes('does not exist')
  );
}

export function isSupabaseConnectionError(error: unknown): boolean {
  const msg = (
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : error instanceof Error
      ? error.message
      : String(error || '')
  ).toLowerCase();

  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('fetcherror') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('load failed')
  );
}

function toStudentRow(st: Student, ownerId: string) {
  const safeCode = sanitizeId(formatStudentCode(st.studentCode), 20);
  const nowIso = new Date().toISOString();
  return {
    student_code: safeCode,
    seq_no: Math.max(1, Math.min(100000, Math.floor(Number(st.seqNo) || 1))),
    prefix: sanitizeString(st.prefix, 1, 30, '-'),
    first_name: sanitizeString(st.firstName, 1, 100, '-'),
    last_name: sanitizeString(st.lastName, 1, 100, '-'),
    nickname: String(st.nickname ?? '').trim().slice(0, 50),
    grade: sanitizeString(st.grade, 1, 30, '-'),
    room: sanitizeString(st.room, 1, 20, '-'),
    dormitory: sanitizeString(st.dormitory, 1, 80, '-'),
    dorm_room: sanitizeString(st.dormRoom, 1, 30, '-'),
    bed: sanitizeString(st.bed, 1, 20, '-'),
    owner_id: sanitizeId(st.ownerId || ownerId, 128),
    created_at: st.createdAt || nowIso,
    updated_at: nowIso,
  };
}

function fromStudentRow(row: Record<string, unknown>): Student {
  return {
    studentCode: formatStudentCode(String(row.student_code || '')),
    seqNo: Number(row.seq_no || 1),
    prefix: String(row.prefix || '-'),
    firstName: String(row.first_name || '-'),
    lastName: String(row.last_name || '-'),
    nickname: String(row.nickname || ''),
    grade: String(row.grade || '-'),
    room: String(row.room || '-'),
    dormitory: String(row.dormitory || '-'),
    dormRoom: String(row.dorm_room || '-'),
    bed: String(row.bed || '-'),
    ownerId: String(row.owner_id || AUTO_CLOUD_OWNER_ID),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function toParcelRow(p: Parcel, ownerId: string) {
  const validStatuses: ParcelStatus[] = [
    'ลงทะเบียนรับพัสดุ',
    'รับเข้าส่วนกลาง',
    'ติดต่องานพยาบาล',
    'ติดนิติการ',
    'พัสดุไม่ทราบเจ้าของ',
    'รอการยืนยัน',
    'ส่งมอบสำเร็จ',
  ];
  const rawStatus =
    (p.status as string) === 'ระหว่างส่งไปหอ' ? 'ลงทะเบียนรับพัสดุ' : p.status;
  const safeStatus: ParcelStatus = validStatuses.includes(rawStatus as ParcelStatus)
    ? (rawStatus as ParcelStatus)
    : 'ลงทะเบียนรับพัสดุ';

  const safeTracking = sanitizeId(p.trackingNumber || p.id, 64);
  const safeStudentCode = sanitizeId(
    p.studentCode === 'UNKNOWN' ? 'UNKNOWN' : formatStudentCode(p.studentCode || 'UNKNOWN'),
    20
  );
  const nowIso = new Date().toISOString();

  return {
    tracking_number: safeTracking,
    student_code: safeStudentCode,
    student_full_name: sanitizeString(p.studentFullName, 1, 220, '-'),
    nickname: String(p.nickname ?? '').trim().slice(0, 50),
    grade_room: sanitizeString(p.gradeRoom, 1, 50, '-'),
    dormitory: sanitizeString(p.dormitory, 1, 80, 'ไม่ระบุหอ'),
    dorm_room: sanitizeString(p.dormRoom, 1, 30, '-'),
    bed: sanitizeString(p.bed, 1, 20, '-'),
    category: sanitizeString(p.category, 1, 100, 'อื่นๆ'),
    status: safeStatus,
    courier: sanitizeString(p.courier, 1, 50, 'Flash Express'),
    note: String(p.note ?? '').trim().slice(0, 300),
    is_six_digits_input: Boolean(p.isSixDigitsInput),
    received_date: sanitizeString(p.receivedDate, 8, 20, getRelativeDateString(0)),
    received_hour: Math.max(0, Math.min(23, Math.floor(Number(p.receivedHour ?? 12)))),
    delivered_date: String(p.deliveredDate ?? '').trim().slice(0, 20),
    owner_id: sanitizeId(p.ownerId || ownerId, 128),
    recorded_by_member_id: String(p.recordedByMemberId || '').slice(0, 80),
    recorded_by_name: String(p.recordedByName || '').slice(0, 150),
    recorded_by_role: String(p.recordedByRole || '').slice(0, 50),
    created_at: p.createdAt || nowIso,
    updated_at: nowIso,
  };
}

function fromParcelRow(row: Record<string, unknown>): Parcel {
  const rawCode = String(row.student_code || '');
  const tracking = String(row.tracking_number || '');
  return {
    id: tracking,
    trackingNumber: tracking,
    studentCode: rawCode === 'UNKNOWN' ? 'UNKNOWN' : formatStudentCode(rawCode),
    studentFullName: String(row.student_full_name || ''),
    nickname: String(row.nickname || ''),
    gradeRoom: String(row.grade_room || '-'),
    dormitory: String(row.dormitory || 'ไม่ระบุหอ'),
    dormRoom: String(row.dorm_room || '-'),
    bed: String(row.bed || '-'),
    category: String(row.category || 'อื่นๆ'),
    status:
      row.status === 'ระหว่างส่งไปหอ'
        ? 'ลงทะเบียนรับพัสดุ'
        : ((row.status as ParcelStatus) || 'ลงทะเบียนรับพัสดุ'),
    courier: String(row.courier || 'Flash Express'),
    note: String(row.note || ''),
    isSixDigitsInput: Boolean(row.is_six_digits_input),
    receivedDate: String(row.received_date || ''),
    receivedHour: Number(row.received_hour ?? 12),
    deliveredDate: row.delivered_date ? String(row.delivered_date) : '',
    ownerId: String(row.owner_id || AUTO_CLOUD_OWNER_ID),
    recordedByMemberId: row.recorded_by_member_id ? String(row.recorded_by_member_id) : undefined,
    recordedByName: row.recorded_by_name ? String(row.recorded_by_name) : undefined,
    recordedByRole: row.recorded_by_role ? String(row.recorded_by_role) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function toMemberRow(m: Member, ownerId: string) {
  const validRoles: MemberRole[] = ['ผู้ดูแลระบบ', 'เจ้าหน้าที่', 'ครู', 'ผู้ใช้'];
  const safeRole: MemberRole = validRoles.includes(m.role) ? m.role : 'เจ้าหน้าที่';
  let menus = sanitizeMenuList(m.allowedMenus);
  if (safeRole === 'ผู้ดูแลระบบ') {
    menus = Array.from(new Set([...menus, ...ALL_MENU_KEYS]));
  }
  const nowIso = new Date().toISOString();
  return {
    member_id: sanitizeId(m.memberId, 64),
    username: sanitizeString(m.username, 1, 80, 'user'),
    password: sanitizeString(m.password, 1, 100, '1234'),
    full_name: sanitizeString(m.fullName, 1, 150, 'ผู้ใช้งาน'),
    role: safeRole,
    allowed_menus: menus,
    use_custom_menus: Boolean(m.useCustomMenus),
    can_edit: m.canEdit !== undefined ? Boolean(m.canEdit) : safeRole !== 'ครู',
    can_delete: m.canDelete !== undefined ? Boolean(m.canDelete) : safeRole === 'ผู้ดูแลระบบ',
    active: m.active !== false,
    owner_id: sanitizeId(m.ownerId || ownerId, 128),
    created_at: m.createdAt || nowIso,
    updated_at: nowIso,
  };
}

function fromMemberRow(row: Record<string, unknown>): Member {
  const rawRole = String(row.role || 'เจ้าหน้าที่');
  const role: MemberRole =
    rawRole === 'ผู้ดูแลระบบ'
      ? 'ผู้ดูแลระบบ'
      : rawRole === 'ครู'
      ? 'ครู'
      : rawRole === 'ผู้ใช้'
      ? 'ผู้ใช้'
      : 'เจ้าหน้าที่';

  let allowedMenus = sanitizeMenuList(row.allowed_menus);
  if (role === 'ผู้ดูแลระบบ') {
    allowedMenus = Array.from(new Set([...allowedMenus, ...ALL_MENU_KEYS]));
  }

  return {
    memberId: String(row.member_id || ''),
    username: String(row.username || ''),
    password: String(row.password || ''),
    fullName: String(row.full_name || ''),
    role,
    allowedMenus,
    useCustomMenus: Boolean(row.use_custom_menus),
    canEdit: row.can_edit !== undefined ? Boolean(row.can_edit) : role !== 'ครู',
    canDelete: row.can_delete !== undefined ? Boolean(row.can_delete) : role === 'ผู้ดูแลระบบ',
    active: row.active !== false,
    ownerId: String(row.owner_id || AUTO_CLOUD_OWNER_ID),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function toRolePermissionRow(rp: RolePermission, ownerId: string) {
  const safeRoleId = (['admin', 'staff', 'teacher', 'user'].includes(rp.roleId)
    ? rp.roleId
    : 'staff') as RolePermission['roleId'];
  const roleName: MemberRole =
    safeRoleId === 'admin'
      ? 'ผู้ดูแลระบบ'
      : safeRoleId === 'teacher'
      ? 'ครู'
      : safeRoleId === 'user'
      ? 'ผู้ใช้'
      : 'เจ้าหน้าที่';
  let menus = sanitizeMenuList(rp.allowedMenus);
  if (safeRoleId === 'admin') {
    menus = Array.from(new Set([...menus, ...ALL_MENU_KEYS]));
  }
  const nowIso = new Date().toISOString();
  return {
    role_id: safeRoleId,
    role_name: roleName,
    allowed_menus: menus,
    can_edit: rp.canEdit !== undefined ? Boolean(rp.canEdit) : safeRoleId !== 'teacher',
    can_delete: rp.canDelete !== undefined ? Boolean(rp.canDelete) : safeRoleId === 'admin',
    owner_id: sanitizeId(rp.ownerId || ownerId, 128),
    created_at: rp.createdAt || nowIso,
    updated_at: nowIso,
  };
}

function fromRolePermissionRow(row: Record<string, unknown>): RolePermission {
  const rawId = String(row.role_id || 'staff');
  const roleId: RolePermission['roleId'] =
    rawId === 'admin'
      ? 'admin'
      : rawId === 'teacher'
      ? 'teacher'
      : rawId === 'user'
      ? 'user'
      : 'staff';
  const roleName: MemberRole =
    roleId === 'admin'
      ? 'ผู้ดูแลระบบ'
      : roleId === 'teacher'
      ? 'ครู'
      : roleId === 'user'
      ? 'ผู้ใช้'
      : 'เจ้าหน้าที่';
  let allowedMenus = sanitizeMenuList(row.allowed_menus);
  if (roleId === 'admin') {
    allowedMenus = Array.from(new Set([...allowedMenus, ...ALL_MENU_KEYS]));
  }
  return {
    roleId,
    roleName,
    allowedMenus,
    canEdit: row.can_edit !== undefined ? Boolean(row.can_edit) : roleId !== 'teacher',
    canDelete: row.can_delete !== undefined ? Boolean(row.can_delete) : roleId === 'admin',
    ownerId: String(row.owner_id || AUTO_CLOUD_OWNER_ID),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function toSystemSettingRow(config: ParcelRateLimitConfig, ownerId: string) {
  const nowIso = new Date().toISOString();
  return {
    setting_id: 'parcel_rate_limits',
    daily_enabled: Boolean(config.daily?.enabled),
    daily_limit: Math.max(0, Math.floor(Number(config.daily?.limit) || 0)),
    weekly_enabled: Boolean(config.weekly?.enabled),
    weekly_limit: Math.max(0, Math.floor(Number(config.weekly?.limit) || 0)),
    monthly_enabled: Boolean(config.monthly?.enabled),
    monthly_limit: Math.max(0, Math.floor(Number(config.monthly?.limit) || 0)),
    owner_id: sanitizeId(ownerId, 128),
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function fromSystemSettingRow(row: Record<string, unknown>): ParcelRateLimitConfig {
  return {
    daily: {
      enabled: Boolean(row.daily_enabled),
      limit: Math.max(0, Number(row.daily_limit) || 1),
    },
    weekly: {
      enabled: Boolean(row.weekly_enabled),
      limit: Math.max(0, Number(row.weekly_limit) || 3),
    },
    monthly: {
      enabled: Boolean(row.monthly_enabled),
      limit: Math.max(0, Number(row.monthly_limit) || 10),
    },
  };
}

/**
 * ตรวจสอบสถานะการเชื่อมต่อ Supabase และเช็คว่ารัน Setup SQL สร้างตารางแล้วหรือยัง
 */
export async function checkSupabaseStatus(): Promise<SupabaseStatusCheck> {
  const checkedAt = new Date().toISOString();
  try {
    const { error } = await supabase
      .from('students')
      .select('student_code')
      .limit(1);

    if (error) {
      return {
        available: false,
        connectionFailed: true,
        schemaMissing: isSupabaseTableMissingError(error),
        checkedAt,
        reason: error.message,
      };
    }

    return {
      available: true,
      connectionFailed: false,
      schemaMissing: false,
      checkedAt,
    };
  } catch (err) {
    return {
      available: false,
      connectionFailed: true,
      schemaMissing: false,
      checkedAt,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface SupabaseTableStatus {
  table: 'students' | 'parcels' | 'members' | 'role_permissions' | 'system_settings';
  label: string;
  exists: boolean;
  count: number | null;
  error?: string;
}

export interface SupabaseConnectionDetails {
  connected: boolean;
  schemaReady: boolean;
  projectRef: string;
  url: string;
  latencyMs: number;
  checkedAt: string;
  tables: SupabaseTableStatus[];
  errorMessage?: string;
}

const SUPABASE_TABLES_TO_CHECK: Array<{
  table: SupabaseTableStatus['table'];
  label: string;
}> = [
  { table: 'students', label: 'รายชื่อนักเรียน' },
  { table: 'parcels', label: 'ข้อมูลพัสดุ' },
  { table: 'members', label: 'สมาชิกและผู้ใช้งาน' },
  { table: 'role_permissions', label: 'สิทธิ์การใช้งาน' },
  { table: 'system_settings', label: 'ตั้งค่าระบบ' },
];

/**
 * ตรวจสอบสถานะการเชื่อมต่อ Supabase และจำนวนข้อมูลในแต่ละตารางแบบละเอียด
 */
export async function checkSupabaseDetailedStatus(): Promise<SupabaseConnectionDetails> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const checkedAt = new Date().toISOString();

  const tables = await Promise.all(
    SUPABASE_TABLES_TO_CHECK.map(async ({ table, label }): Promise<SupabaseTableStatus> => {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (error) {
          return {
            table,
            label,
            exists: !isSupabaseTableMissingError(error),
            count: null,
            error: error.message,
          };
        }

        return {
          table,
          label,
          exists: true,
          count: typeof count === 'number' ? count : 0,
        };
      } catch (err) {
        return {
          table,
          label,
          exists: false,
          count: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const latencyMs = Math.max(1, Math.round(endedAt - startedAt));

  const anyConnectionError = tables.some(
    (t) =>
      t.error &&
      (t.error.toLowerCase().includes('failed to fetch') ||
        t.error.toLowerCase().includes('network') ||
        t.error.toLowerCase().includes('timeout'))
  );
  const schemaReady = tables.every((t) => t.exists && !t.error);
  const connected = !anyConnectionError && (schemaReady || tables.some((t) => !t.error || isSupabaseTableMissingError({ message: t.error })));

  return {
    connected,
    schemaReady,
    projectRef: SUPABASE_PROJECT_REF,
    url: SUPABASE_URL,
    latencyMs,
    checkedAt,
    tables,
    errorMessage: anyConnectionError
      ? 'ไม่สามารถติดต่อเซิร์ฟเวอร์ Supabase ได้ในขณะนี้'
      : !schemaReady
      ? 'เชื่อมต่อ Supabase สำเร็จ แต่ยังสร้างตารางไม่ครบ (กรุณารัน setup.sql)'
      : undefined,
  };
}

/**
 * ดึงข้อมูลทั้งหมดจากตาราง Supabase (รองรับข้อมูลมากกว่า 1,000 แถวอัตโนมัติด้วยการแบ่งหน้า)
 */
async function selectAllPaginated(table: string, orderCol?: string, ascending = true) {
  const PAGE_SIZE = 1000;
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1);

    if (orderCol) {
      query = query.order(orderCol, { ascending });
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

/**
 * ตั้งค่าข้อมูลเริ่มต้นใน Supabase หากตารางยังว่างเปล่า
 */
export async function initializeDefaultSupabaseDataIfEmpty(
  ownerId: string = AUTO_CLOUD_OWNER_ID
): Promise<{ schemaMissing?: boolean }> {
  try {
    const { data: rpCheck, error: rpErr } = await supabase
      .from('role_permissions')
      .select('role_id')
      .limit(1);

    if (rpErr) {
      if (isSupabaseTableMissingError(rpErr)) return { schemaMissing: true };
      return {};
    }

    if (!rpCheck || rpCheck.length === 0) {
      await supabase
        .from('role_permissions')
        .upsert(
          INITIAL_ROLE_PERMISSIONS.map((rp) => toRolePermissionRow(rp, ownerId)),
          { onConflict: 'role_id' }
        );
    }

    const { data: mCheck } = await supabase
      .from('members')
      .select('member_id')
      .limit(1);

    if (!mCheck || mCheck.length === 0) {
      await supabase
        .from('members')
        .upsert(
          INITIAL_MEMBERS.map((m) => toMemberRow(m, ownerId)),
          { onConflict: 'member_id' }
        );
    }

    const { data: stCheck } = await supabase
      .from('students')
      .select('student_code')
      .limit(1);

    if (!stCheck || stCheck.length === 0) {
      await supabase
        .from('students')
        .upsert(
          INITIAL_STUDENTS.map((s) => toStudentRow(s, ownerId)),
          { onConflict: 'student_code' }
        );
    }

    const { data: pCheck } = await supabase
      .from('parcels')
      .select('tracking_number')
      .limit(1);

    if (!pCheck || pCheck.length === 0) {
      await supabase
        .from('parcels')
        .upsert(
          INITIAL_PARCELS.map((p) => toParcelRow(p, ownerId)),
          { onConflict: 'tracking_number' }
        );
    }

    const { data: sCheck } = await supabase
      .from('system_settings')
      .select('setting_id')
      .limit(1);

    if (!sCheck || sCheck.length === 0) {
      await supabase
        .from('system_settings')
        .upsert([toSystemSettingRow(DEFAULT_PARCEL_RATE_LIMIT_CONFIG, ownerId)], {
          onConflict: 'setting_id',
        });
    }

    return {};
  } catch (error) {
    if (isSupabaseTableMissingError(error)) {
      return { schemaMissing: true };
    }
    return {};
  }
}

/**
 * ดึงข้อมูลทั้งหมดจาก Supabase
 */
export async function fetchCloudDataFromSupabase(
  _primaryOwnerId: string = AUTO_CLOUD_OWNER_ID,
  _secondaryAuthUid?: string | null
): Promise<{
  students: Student[];
  parcels: Parcel[];
  members: Member[];
  rolePermissions: RolePermission[];
  rateLimitConfig: ParcelRateLimitConfig | null;
  readsCount: number;
  quotaExceeded?: boolean;
  connectionFailed?: boolean;
  schemaMissing?: boolean;
  errorMessage?: string;
}> {
  try {
    const [studentRows, parcelRows, memberRows, rolePermRows, settingRes] =
      await Promise.all([
        selectAllPaginated('students', 'seq_no', true),
        selectAllPaginated('parcels', 'created_at', false),
        selectAllPaginated('members'),
        selectAllPaginated('role_permissions'),
        supabase
          .from('system_settings')
          .select('*')
          .eq('setting_id', 'parcel_rate_limits')
          .maybeSingle(),
      ]);

    if (settingRes.error && isSupabaseTableMissingError(settingRes.error)) {
      throw settingRes.error;
    }

    const students = studentRows.map(fromStudentRow);
    const parcels = parcelRows.map(fromParcelRow);
    const members = memberRows.map(fromMemberRow);
    const rolePermissions = rolePermRows.map(fromRolePermissionRow);
    const rateLimitConfig = settingRes.data
      ? fromSystemSettingRow(settingRes.data as Record<string, unknown>)
      : null;

    return {
      students,
      parcels,
      members,
      rolePermissions,
      rateLimitConfig,
      readsCount:
        students.length + parcels.length + members.length + rolePermissions.length + 1,
      quotaExceeded: false,
      connectionFailed: false,
      schemaMissing: false,
    };
  } catch (error) {
    const schemaMissing = isSupabaseTableMissingError(error);
    return {
      students: [],
      parcels: [],
      members: [],
      rolePermissions: [],
      rateLimitConfig: null,
      readsCount: 0,
      quotaExceeded: false,
      connectionFailed: true,
      schemaMissing,
      errorMessage:
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message)
          : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

/**
 * บันทึก/ลบข้อมูลลง Supabase แบบ Batch (Chunks ละ 400 รายการ พร้อม deduplicate PK)
 */
export async function saveBatchDirectlyToSupabase(
  items: SupabaseWriteItem[],
  ownerId: string = AUTO_CLOUD_OWNER_ID,
  onProgress?: (completed: number, total: number) => void
): Promise<{
  uploadedCount: number;
  connectionFailed?: boolean;
  schemaMissing?: boolean;
  errorMessage?: string;
}> {
  if (items.length === 0) return { uploadedCount: 0 };
  const effectiveOwnerId = ownerId || AUTO_CLOUD_OWNER_ID;
  const CHUNK_SIZE = 400;
  let uploadedCount = 0;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);

    const parcelUpserts = new Map<string, ReturnType<typeof toParcelRow>>();
    const parcelDeletes = new Set<string>();
    const studentUpserts = new Map<string, ReturnType<typeof toStudentRow>>();
    const studentDeletes = new Set<string>();
    const memberUpserts = new Map<string, ReturnType<typeof toMemberRow>>();
    const memberDeletes = new Set<string>();
    const rolePermUpserts = new Map<string, ReturnType<typeof toRolePermissionRow>>();
    const rolePermDeletes = new Set<string>();
    const settingUpserts = new Map<string, ReturnType<typeof toSystemSettingRow>>();

    for (const item of chunk) {
      if (item.collection === 'parcels') {
        const safeId = sanitizeId(item.docId, 64);
        if (item.action === 'delete') {
          parcelUpserts.delete(safeId);
          parcelDeletes.add(safeId);
        } else if (item.data) {
          parcelDeletes.delete(safeId);
          const row = toParcelRow(item.data as Parcel, effectiveOwnerId);
          parcelUpserts.set(row.tracking_number, row);
        }
      } else if (item.collection === 'students') {
        const safeCode = sanitizeId(formatStudentCode(item.docId), 20);
        if (item.action === 'delete') {
          studentUpserts.delete(safeCode);
          studentDeletes.add(safeCode);
        } else if (item.data) {
          studentDeletes.delete(safeCode);
          const row = toStudentRow(item.data as Student, effectiveOwnerId);
          studentUpserts.set(row.student_code, row);
        }
      } else if (item.collection === 'members') {
        const safeId = sanitizeId(item.docId, 64);
        if (item.action === 'delete') {
          memberUpserts.delete(safeId);
          memberDeletes.add(safeId);
        } else if (item.data) {
          memberDeletes.delete(safeId);
          const row = toMemberRow(item.data as Member, effectiveOwnerId);
          memberUpserts.set(row.member_id, row);
        }
      } else if (item.collection === 'role_permissions') {
        const safeRoleId = sanitizeId(item.docId, 20);
        if (item.action === 'delete') {
          rolePermUpserts.delete(safeRoleId);
          rolePermDeletes.add(safeRoleId);
        } else if (item.data) {
          rolePermDeletes.delete(safeRoleId);
          const row = toRolePermissionRow(item.data as RolePermission, effectiveOwnerId);
          rolePermUpserts.set(row.role_id, row);
        }
      } else if (item.collection === 'system_settings') {
        if (item.action !== 'delete' && item.data) {
          const row = toSystemSettingRow(
            item.data as ParcelRateLimitConfig,
            effectiveOwnerId
          );
          settingUpserts.set(row.setting_id, row);
        }
      }
    }

    try {
      if (studentUpserts.size > 0) {
        const { error } = await supabase
          .from('students')
          .upsert(Array.from(studentUpserts.values()), { onConflict: 'student_code' });
        if (error) throw error;
      }
      if (studentDeletes.size > 0) {
        const { error } = await supabase
          .from('students')
          .delete()
          .in('student_code', Array.from(studentDeletes));
        if (error) throw error;
      }

      if (parcelUpserts.size > 0) {
        const { error } = await supabase
          .from('parcels')
          .upsert(Array.from(parcelUpserts.values()), { onConflict: 'tracking_number' });
        if (error) throw error;
      }
      if (parcelDeletes.size > 0) {
        const { error } = await supabase
          .from('parcels')
          .delete()
          .in('tracking_number', Array.from(parcelDeletes));
        if (error) throw error;
      }

      if (memberUpserts.size > 0) {
        const { error } = await supabase
          .from('members')
          .upsert(Array.from(memberUpserts.values()), { onConflict: 'member_id' });
        if (error) throw error;
      }
      if (memberDeletes.size > 0) {
        const { error } = await supabase
          .from('members')
          .delete()
          .in('member_id', Array.from(memberDeletes));
        if (error) throw error;
      }

      if (rolePermUpserts.size > 0) {
        const { error } = await supabase
          .from('role_permissions')
          .upsert(Array.from(rolePermUpserts.values()), { onConflict: 'role_id' });
        if (error) throw error;
      }
      if (rolePermDeletes.size > 0) {
        const { error } = await supabase
          .from('role_permissions')
          .delete()
          .in('role_id', Array.from(rolePermDeletes));
        if (error) throw error;
      }

      if (settingUpserts.size > 0) {
        const { error } = await supabase
          .from('system_settings')
          .upsert(Array.from(settingUpserts.values()), { onConflict: 'setting_id' });
        if (error) throw error;
      }

      uploadedCount += chunk.length;
      if (onProgress) {
        onProgress(uploadedCount, items.length);
      }
    } catch (error) {
      const schemaMissing = isSupabaseTableMissingError(error);
      const errMsg =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message)
          : error instanceof Error
          ? error.message
          : String(error);

      return {
        uploadedCount,
        connectionFailed: true,
        schemaMissing,
        errorMessage: errMsg,
      };
    }
  }

  return { uploadedCount };
}

/**
 * ค้นหานักเรียนรายบุคคลจาก Supabase (Fallback เมื่อไม่พบในแคชในเครื่อง)
 */
export async function findStudentInSupabaseFallback(
  studentCode: string
): Promise<{ student: Student | null; readsCount: number }> {
  const formatted = formatStudentCode(studentCode.trim());
  const safeCode = sanitizeId(formatted, 20);
  if (!safeCode || safeCode === 'ID001') {
    return { student: null, readsCount: 0 };
  }
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('student_code', safeCode)
      .maybeSingle();
    if (error || !data) return { student: null, readsCount: 1 };
    return {
      student: fromStudentRow(data as Record<string, unknown>),
      readsCount: 1,
    };
  } catch {
    return { student: null, readsCount: 0 };
  }
}

/**
 * ค้นหาพัสดุจาก Supabase แบบเจาะจง (Fallback)
 */
export async function findParcelInSupabaseFallback(
  keyword: string
): Promise<{ parcels: Parcel[]; readsCount: number }> {
  const clean = keyword.trim();
  if (!clean) return { parcels: [], readsCount: 0 };

  const resultMap = new Map<string, Parcel>();
  let readsCount = 0;

  const safeTracking = clean.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (safeTracking.length >= 4 && safeTracking.length <= 64) {
    try {
      const { data } = await supabase
        .from('parcels')
        .select('*')
        .eq('tracking_number', safeTracking)
        .maybeSingle();
      readsCount += 1;
      if (data) {
        const p = fromParcelRow(data as Record<string, unknown>);
        resultMap.set(p.id, p);
      }
    } catch {
      // ignore
    }
  }

  if (resultMap.size === 0 && /^\d{4,6}$/.test(clean)) {
    const formattedCode = formatStudentCode(clean);
    try {
      const { data } = await supabase
        .from('parcels')
        .select('*')
        .eq('student_code', formattedCode)
        .order('created_at', { ascending: false })
        .limit(30);
      readsCount += data?.length || 1;
      if (data) {
        for (const row of data) {
          const p = fromParcelRow(row as Record<string, unknown>);
          resultMap.set(p.id, p);
        }
      }
    } catch {
      // ignore
    }
  }

  if (resultMap.size === 0 && clean.length >= 2) {
    const safePattern = clean.replace(/[%_,()]/g, '').trim();
    if (safePattern.length >= 2) {
      try {
        const { data } = await supabase
          .from('parcels')
          .select('*')
          .or(
            `tracking_number.ilike.%${safePattern}%,student_full_name.ilike.%${safePattern}%,student_code.ilike.%${safePattern}%`
          )
          .order('created_at', { ascending: false })
          .limit(30);
        readsCount += data?.length || 1;
        if (data) {
          for (const row of data) {
            const p = fromParcelRow(row as Record<string, unknown>);
            resultMap.set(p.id, p);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    parcels: Array.from(resultMap.values()),
    readsCount,
  };
}
