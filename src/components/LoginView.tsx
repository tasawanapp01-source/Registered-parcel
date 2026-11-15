import React, { useState } from 'react';
import {
  Lock,
  User,
  KeyRound,
  ArrowRight,
  AlertCircle,
  PackageCheck,
  ShieldCheck,
  Boxes,
  Database,
  RefreshCw,
} from 'lucide-react';
import { useParcelSystem } from '../context/ParcelSystemContext';

export const LoginView: React.FC = () => {
  const {
    loginWithCredentials,
    supabaseConnectionDetails,
    isCheckingSupabaseStatus,
    refreshSupabaseConnectionStatus,
  } = useParcelSystem();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsSubmitting(true);
    const result = loginWithCredentials(username, password);
    if (!result.success) {
      setErrorMsg(result.message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden selection:bg-indigo-100 selection:text-indigo-900">
      {/* Background radial gradients for bright light theme */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-indigo-200/50 via-sky-200/30 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[450px] h-[450px] bg-emerald-100/60 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-10 left-10 w-[350px] h-[350px] bg-amber-100/50 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Branding & Header */}
        <div className="text-center mb-8">
          {/* New Modern System Logo */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-600 to-blue-500 text-white mb-4 shadow-xl shadow-indigo-500/25 ring-8 ring-indigo-50/80 transition-transform hover:scale-105 duration-200">
            <PackageCheck className="w-8 h-8" />
          </div>

          {/* System Title with Icons */}
          <div className="flex items-center justify-center gap-2 mb-1.5 flex-wrap">
            <Boxes className="w-6 h-6 text-indigo-600 shrink-0" />
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              ระบบลงทะเบียนพัสดุ
            </h1>
            <PackageCheck className="w-6 h-6 text-emerald-600 shrink-0 hidden sm:inline-block" />
          </div>
          <p className="text-xs sm:text-sm font-medium text-slate-500">
            Student Parcel Registration & Tracking System
          </p>
        </div>

        {/* Login Card (Light Bright Theme) */}
        <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-200/60">
          <div className="flex items-center justify-between pb-5 border-b border-slate-100 mb-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">เข้าสู่ระบบ</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                กรอกชื่อผู้ใช้งานและรหัสผ่านเพื่อเข้าใช้งานระบบ
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200/70 flex items-center justify-center text-slate-600">
              <Lock className="w-4 h-4" />
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-2.5 shadow-xs"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span className="font-semibold">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                ชื่อผู้ใช้งาน (Username)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="กรอกชื่อผู้ใช้งาน"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 transition-all"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                รหัสผ่าน (Password)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="กรอกรหัสผ่าน"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-3 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>เข้าสู่ระบบ</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>ความปลอดภัยระดับระบบ: ผู้ดูแลระบบ · เจ้าหน้าที่ · ครู</span>
          </div>
        </div>

        {/* Supabase Database Connection Status Card */}
        <div className="mt-4 bg-white/90 backdrop-blur-sm border border-slate-200/90 rounded-2xl p-3.5 shadow-sm text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  !supabaseConnectionDetails || isCheckingSupabaseStatus
                    ? 'bg-slate-400 animate-pulse'
                    : supabaseConnectionDetails.connected && supabaseConnectionDetails.schemaReady
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                }`}
              />
              <Database className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="font-bold text-slate-800 truncate">
                {isCheckingSupabaseStatus
                  ? 'กำลังตรวจสอบการเชื่อมต่อ Supabase...'
                  : !supabaseConnectionDetails
                  ? 'กำลังเตรียมเชื่อมต่อ Supabase...'
                  : supabaseConnectionDetails.connected && supabaseConnectionDetails.schemaReady
                  ? 'เชื่อมต่อฐานข้อมูล Supabase สำเร็จ'
                  : supabaseConnectionDetails.connected
                  ? 'เชื่อมต่อ Supabase แล้ว (รอสร้างตาราง)'
                  : 'ไม่สามารถเชื่อมต่อ Supabase'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => void refreshSupabaseConnectionStatus(false)}
              disabled={isCheckingSupabaseStatus}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
              title="ตรวจสอบการเชื่อมต่อ Supabase อีกครั้ง"
            >
              <RefreshCw className={`w-3 h-3 ${isCheckingSupabaseStatus ? 'animate-spin' : ''}`} />
              <span>ตรวจสอบ</span>
            </button>
          </div>

          {supabaseConnectionDetails && (
            <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span className="font-mono text-slate-700">
                {supabaseConnectionDetails.projectRef}.supabase.co ·{' '}
                <strong className="text-emerald-700">{supabaseConnectionDetails.latencyMs} ms</strong>
              </span>
              {supabaseConnectionDetails.schemaReady && (
                <span className="font-mono text-slate-600">
                  นักเรียน{' '}
                  <strong className="text-slate-900">
                    {(
                      supabaseConnectionDetails.tables.find((t) => t.table === 'students')?.count ?? 0
                    ).toLocaleString()}
                  </strong>{' '}
                  · พัสดุ{' '}
                  <strong className="text-slate-900">
                    {(
                      supabaseConnectionDetails.tables.find((t) => t.table === 'parcels')?.count ?? 0
                    ).toLocaleString()}
                  </strong>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-slate-500 mt-4">
          หากลืมรหัสผ่านหรือต้องการเพิ่มบัญชีผู้ใช้ใหม่ กรุณาติดต่อผู้ดูแลระบบ
        </p>
      </div>
    </div>
  );
};
