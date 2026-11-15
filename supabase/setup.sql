-- ============================================================================
-- Student Parcel Management & Tracking System - Supabase PostgreSQL Schema
-- คัดลอกทั้งหมดไปวางใน Supabase Dashboard > SQL Editor แล้วกด Run เพียงครั้งเดียว
-- ============================================================================

-- 1. ตารางข้อมูลนักเรียน (Students)
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

-- 2. ตารางข้อมูลพัสดุ (Parcels)
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

-- 3. ตารางบัญชีสมาชิกผู้ใช้งาน (Members)
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

-- 4. ตารางสิทธิ์ตามบทบาท (Role Permissions)
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

-- 5. ตารางตั้งค่าระบบ (System Settings)
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

-- เปิด Row Level Security (RLS) และตั้งค่า Policy สำหรับการทำงานร่วมกับ Publishable Key ของแอป
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

-- รีโหลด Schema Cache ของ PostgREST ทันที
NOTIFY pgrst, 'reload schema';
