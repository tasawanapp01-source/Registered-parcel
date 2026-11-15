import React, { useState, useMemo, useCallback } from 'react';
import {
  Search,
  PackageCheck,
  Boxes,
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
  MapPin,
  Building2,
  User,
  CalendarCheck,
  ClipboardCheck,
  RefreshCw,
  X,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { useParcelSystem } from '../context/ParcelSystemContext';
import {
  Parcel,
  formatStudentCode,
  formatThaiSlashDate,
  formatParcelRegistrationDateTime,
  getDormitoryTheme,
  isRedHighlightTrackingNumber,
} from '../types/parcel';

interface PublicParcelSearchViewProps {
  onGoToLogin: () => void;
}

export const PublicParcelSearchView: React.FC<PublicParcelSearchViewProps> = ({
  onGoToLogin,
}) => {
  const {
    parcels,
    students,
    isSyncing,
    refreshFromSupabase,
    searchParcelsWithCloudFallback,
  } = useParcelSystem();

  const [searchInput, setSearchInput] = useState<string>('');
  const [searchedKeyword, setSearchedKeyword] = useState<string>('');
  const [isSearchingCloud, setIsSearchingCloud] = useState<boolean>(false);

  // ค้นหาแบบรวมในช่องเดียว: เลขพัสดุ, ชื่อ, นามสกุล, หรือ รหัสนักเรียน
  const matchParcelsByUnifiedQuery = useCallback(
    (rawQuery: string, sourceParcels: Parcel[]): Parcel[] => {
      const clean = rawQuery.trim().toLowerCase();
      if (!clean) return [];

      const tokens = clean.split(/\s+/).filter(Boolean);
      const formattedCode = formatStudentCode(clean).toLowerCase();
      const normalizedCompact = clean.replace(/\s+/g, '');

      // ค้นหาจากทะเบียนนักเรียนที่ตรงกับ ชื่อ, นามสกุล, ชื่อเล่น หรือ รหัสนักเรียน เพื่อจับคู่รหัสนักเรียนได้แม่นยำ
      const matchedStudentCodes = new Set<string>();
      for (const st of students) {
        const stCode = (st.studentCode || '').trim().toLowerCase();
        const stCodeFmt = formatStudentCode(stCode).toLowerCase();
        const fullNameNoPrefix = `${st.firstName} ${st.lastName}`.toLowerCase();
        const fullNameWithPrefix = `${st.prefix}${st.firstName} ${st.lastName}`.toLowerCase();
        const nick = (st.nickname || '').toLowerCase();

        const codeMatch =
          stCode.includes(clean) ||
          (formattedCode !== clean && stCodeFmt.includes(formattedCode));
        const nameTokensMatch = tokens.every(
          (tok) =>
            fullNameWithPrefix.includes(tok) ||
            fullNameNoPrefix.includes(tok) ||
            nick.includes(tok)
        );

        if (codeMatch || nameTokensMatch) {
          if (stCode) matchedStudentCodes.add(stCode);
          if (stCodeFmt) matchedStudentCodes.add(stCodeFmt);
        }
      }

      return sourceParcels.filter((p) => {
        const tracking = (p.trackingNumber || '').trim().toLowerCase();
        const trackingCompact = tracking.replace(/\s+/g, '');
        const pCode = (p.studentCode || '').trim().toLowerCase();
        const pCodeFmt = formatStudentCode(pCode).toLowerCase();
        const fullName = (p.studentFullName || '').trim().toLowerCase();
        const nick = (p.nickname || '').trim().toLowerCase();

        // 1. ค้นหาตามเลขพัสดุ
        if (
          tracking.includes(clean) ||
          trackingCompact.includes(normalizedCompact)
        ) {
          return true;
        }

        // 2. ค้นหาตามรหัสนักเรียน
        if (
          pCode.includes(clean) ||
          (formattedCode !== clean && pCodeFmt.includes(formattedCode)) ||
          matchedStudentCodes.has(pCode) ||
          matchedStudentCodes.has(pCodeFmt)
        ) {
          return true;
        }

        // 3. ค้นหาตามชื่อ / นามสกุล (รองรับพิมพ์เว้นวรรค เช่น "สมชาย ใจดี" แม้ในระบบมีคำนำหน้า)
        const combinedName = `${fullName} ${nick}`.trim();
        if (tokens.length > 0 && tokens.every((tok) => combinedName.includes(tok))) {
          return true;
        }

        return false;
      });
    },
    [students]
  );

  const handleExecuteSearch = useCallback(
    async (explicitQuery?: string) => {
      const target = explicitQuery !== undefined ? explicitQuery : searchInput;
      const trimmed = target.trim();
      setSearchedKeyword(trimmed);
      if (!trimmed) return;

      const localMatches = matchParcelsByUnifiedQuery(trimmed, parcels);
      if (localMatches.length === 0 && trimmed.length >= 2) {
        setIsSearchingCloud(true);
        try {
          await searchParcelsWithCloudFallback(trimmed, 'ALL', 'ALL', 'ALL');
        } finally {
          setIsSearchingCloud(false);
        }
      }
    },
    [searchInput, parcels, matchParcelsByUnifiedQuery, searchParcelsWithCloudFallback]
  );

  const handleClearSearch = () => {
    setSearchInput('');
    setSearchedKeyword('');
  };

  const matchedParcels = useMemo(() => {
    if (!searchedKeyword.trim()) return [];
    return matchParcelsByUnifiedQuery(searchedKeyword, parcels);
  }, [searchedKeyword, parcels, matchParcelsByUnifiedQuery]);

  const summaryCounts = useMemo(() => {
    let received = 0;
    let pending = 0;
    for (const p of matchedParcels) {
      if (p.status === 'ส่งมอบสำเร็จ') {
        received += 1;
      } else {
        pending += 1;
      }
    }
    return { received, pending };
  }, [matchedParcels]);

  const hasSearched = searchedKeyword.trim().length > 0;
  const isLoading = isSearchingCloud || (isSyncing && parcels.length === 0);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-indigo-100 selection:text-indigo-900">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-2xs">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 text-white flex items-center justify-center shadow-xs shrink-0">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Boxes className="w-4 h-4 text-indigo-600 hidden sm:inline-block shrink-0" />
                <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 truncate">
                  ค้นหาสถานะพัสดุนักเรียน
                </h1>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                ตรวจสอบสถานะพัสดุและหอพักปลายทางได้ทันที ไม่ต้องเข้าสู่ระบบ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void refreshFromSupabase()}
              disabled={isSyncing}
              title="อัปเดตข้อมูลล่าสุด"
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">อัปเดตข้อมูล</span>
            </button>

            <a
              href="#login"
              onClick={(e) => {
                e.preventDefault();
                onGoToLogin();
              }}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>เข้าสู่ระบบเจ้าหน้าที่</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Search Workspace */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {/* Search Card */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
              ค้นหาพัสดุของท่าน
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              กรอก <strong className="text-slate-800">เลขพัสดุ</strong>,{' '}
              <strong className="text-slate-800">ชื่อ</strong>,{' '}
              <strong className="text-slate-800">นามสกุล</strong> หรือ{' '}
              <strong className="text-slate-800">รหัสนักเรียน</strong> ในช่องค้นหาด้านล่าง
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleExecuteSearch();
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <div className="relative flex-1">
              <label htmlFor="public-parcel-search-input" className="sr-only">
                ค้นหาเลขพัสดุ ชื่อ นามสกุล หรือรหัสนักเรียน
              </label>
              <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="public-parcel-search-input"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="พิมพ์เลขพัสดุ, ชื่อ-นามสกุล หรือ รหัสนักเรียน..."
                autoFocus
                className="w-full min-h-[52px] pl-12 pr-10 py-3 text-sm sm:text-base text-slate-900 bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label="ล้างคำค้นหา"
                  onClick={handleClearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={!searchInput.trim() || isSearchingCloud}
              className="min-h-[52px] px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-bold rounded-xl inline-flex items-center justify-center gap-2 transition-colors shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Search className="w-4 h-4" />
              <span>{isSearchingCloud ? 'กำลังค้นหา...' : 'ค้นหาพัสดุ'}</span>
            </button>
          </form>

          {/* Status Color Legend */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-500 font-semibold">ความหมายสีสถานะ:</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
              รับพัสดุแล้ว (สีเขียว)
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-400 text-amber-900 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              ยังไม่รับพัสดุ (สีเหลืองส้ม)
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 border border-red-300 text-red-800 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
              ไม่พบข้อมูลพัสดุ (สีแดง)
            </span>
          </div>
        </section>

        {/* Search Results Section */}
        {!hasSearched ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Package className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-slate-900">
              กรอกข้อมูลเพื่อตรวจสอบสถานะและจุดรับพัสดุ
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
              ระบบจะแสดงสถานะการลงรับข้อมูลเข้าระบบ หอพักที่พัสดุถูกคัดแยกส่งไป และสถานะการรับพัสดุของนักเรียน
            </p>
          </div>
        ) : isLoading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
            <p className="text-sm font-bold text-slate-800">
              กำลังค้นหาข้อมูลพัสดุ "{searchedKeyword}"...
            </p>
          </div>
        ) : matchedParcels.length === 0 ? (
          /* ไม่พบข้อมูลพัสดุ -> สีแดง */
          <div
            role="alert"
            className="bg-red-50 border-2 border-red-400 rounded-2xl p-6 sm:p-8 shadow-sm text-center space-y-3"
          >
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-md shadow-red-600/20">
              <XCircle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <span className="inline-block px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-extrabold tracking-wide">
                ไม่พบข้อมูลพัสดุ
              </span>
              <h3 className="text-lg font-extrabold text-red-950 pt-1">
                ไม่พบรายการพัสดุที่ตรงกับ "{searchedKeyword}"
              </h3>
              <p className="text-xs sm:text-sm text-red-800 max-w-md mx-auto leading-relaxed">
                กรุณาตรวจสอบเลขพัสดุ ชื่อ-นามสกุล หรือรหัสนักเรียนอีกครั้ง
                หรืออาจเป็นพัสดุที่เจ้าหน้าที่ยังไม่ได้ลงทะเบียนรับเข้าระบบ
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleClearSearch}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                ล้างคำค้นหาและลองใหม่
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Result Summary Header */}
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="text-slate-700 font-semibold">
                ผลการค้นหา "{searchedKeyword}" พบ{' '}
                <strong className="font-mono text-slate-900 text-sm tabular-nums">
                  {matchedParcels.length}
                </strong>{' '}
                รายการ
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {summaryCounts.received > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold">
                    รับแล้ว {summaryCounts.received} รายการ
                  </span>
                )}
                {summaryCounts.pending > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-400 font-bold">
                    ยังไม่รับ {summaryCounts.pending} รายการ
                  </span>
                )}
              </div>
            </div>

            {/* Parcel Cards */}
            <div className="space-y-4">
              {matchedParcels.map((parcel) => {
                const isReceived = parcel.status === 'ส่งมอบสำเร็จ';
                const dormTheme = getDormitoryTheme(parcel.dormitory);
                const isLegalHold = parcel.status === 'ติดนิติการ';
                const isInfirmary = parcel.status === 'ติดต่องานพยาบาล';
                const hasDormitory =
                  Boolean(parcel.dormitory) &&
                  parcel.dormitory.trim() !== '-' &&
                  parcel.dormitory.trim() !== 'ไม่ระบุหอ';

                return (
                  <article
                    key={parcel.id}
                    className={`bg-white rounded-2xl border-2 overflow-hidden shadow-xs transition-all ${
                      isReceived
                        ? 'border-emerald-400'
                        : 'border-amber-400'
                    }`}
                  >
                    {/* Status Top Banner: เขียว = รับแล้ว, เหลืองส้ม = ยังไม่รับ */}
                    <div
                      className={`px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2 border-b ${
                        isReceived
                          ? 'bg-emerald-600 text-white border-emerald-700'
                          : 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 border-amber-600/30'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isReceived ? (
                          <CheckCircle2 className="w-5 h-5 shrink-0 text-white" />
                        ) : (
                          <Clock className="w-5 h-5 shrink-0 text-slate-950" />
                        )}
                        <span className="text-sm font-extrabold">
                          {isReceived
                            ? 'สถานะพัสดุ: รับพัสดุแล้ว'
                            : 'สถานะพัสดุ: ยังไม่รับพัสดุ'}
                        </span>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${
                          isReceived
                            ? 'bg-emerald-800/60 text-white border border-emerald-300/40'
                            : 'bg-white/90 text-amber-950 border border-amber-700/20'
                        }`}
                      >
                        {parcel.status === 'ติดนิติการ'
                          ? 'พัสดุติดนิติการ'
                          : parcel.status}
                      </span>
                    </div>

                    {/* Card Body */}
                    <div className="p-4 sm:p-5 space-y-4">
                      {/* Tracking & Courier */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500">
                            เลขพัสดุ:
                          </span>
                          <span
                            className={`font-mono text-base sm:text-lg font-extrabold tracking-tight tabular-nums ${
                              isRedHighlightTrackingNumber(parcel.trackingNumber, parcel)
                                ? 'text-red-600'
                                : 'text-slate-900'
                            }`}
                          >
                            {parcel.trackingNumber}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-semibold border border-slate-200">
                            {parcel.courier}
                          </span>
                          <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-800 font-semibold border border-indigo-200">
                            {parcel.category}
                          </span>
                        </div>
                      </div>

                      {/* Recipient & Dormitory Destination Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {/* ข้อมูลนักเรียนผู้รับ */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                            <User className="w-3.5 h-3.5 text-indigo-600" />
                            <span>ข้อมูลผู้รับพัสดุ</span>
                          </div>
                          <div className="text-sm sm:text-base font-extrabold text-slate-900">
                            {parcel.studentFullName || 'ไม่ระบุชื่อ'}
                            {parcel.nickname ? (
                              <span className="font-semibold text-slate-600">
                                {' '}
                                ({parcel.nickname})
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            <span className="font-mono font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200 tabular-nums">
                              รหัส {formatStudentCode(parcel.studentCode) || '-'}
                            </span>
                            {parcel.gradeRoom && parcel.gradeRoom !== '-' && (
                              <span>ชั้น {parcel.gradeRoom}</span>
                            )}
                          </div>
                        </div>

                        {/* ที่อยู่พัสดุส่งไปหอพักไหน */}
                        <div
                          className={`rounded-xl p-3.5 border space-y-1.5 ${
                            hasDormitory
                              ? `${dormTheme.bgClass} ${dormTheme.borderClass}`
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                            <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span>ที่อยู่พัสดุ / หอพักปลายทาง</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: dormTheme.hexColor }}
                            />
                            <span className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                              <Building2 className="w-4 h-4 shrink-0 text-slate-700" />
                              <span>{parcel.dormitory || 'ยังไม่ระบุหอพัก'}</span>
                            </span>
                            {dormTheme.basketCode && dormTheme.basketCode !== '-' && (
                              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-white/80 text-slate-800 border border-slate-300/70">
                                {dormTheme.basketCode}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 font-medium">
                            <span>ห้องพัก: {parcel.dormRoom || '-'}</span>
                            {parcel.bed && parcel.bed !== '-' && (
                              <>
                                <span className="text-slate-400">·</span>
                                <span>เตียง: {parcel.bed}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ข้อมูลการลงรับข้อมูล & สถานะการส่งมอบ */}
                      <div
                        className={`rounded-xl p-3.5 border space-y-2 text-xs ${
                          isReceived
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                            : 'bg-amber-50/80 border-amber-300 text-amber-950'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-extrabold">
                          <ClipboardCheck
                            className={`w-4 h-4 shrink-0 ${
                              isReceived ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          />
                          <span>ข้อมูลการลงรับและสถานะพัสดุ</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="flex items-start gap-2">
                            <CalendarCheck
                              className={`w-4 h-4 shrink-0 mt-0.5 ${
                                isReceived ? 'text-emerald-600' : 'text-amber-700'
                              }`}
                            />
                            <div>
                              <div className="font-bold">ลงรับข้อมูลเข้าระบบ</div>
                              <div className="font-mono text-[11px] sm:text-xs">
                                {formatParcelRegistrationDateTime(parcel)}
                              </div>
                              {parcel.recordedByName && (
                                <div className="text-[11px] opacity-80">
                                  ผู้ลงรับข้อมูล: {parcel.recordedByName}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            {isReceived ? (
                              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                            )}
                            <div>
                              <div className="font-bold">
                                {isReceived
                                  ? 'รับพัสดุเรียบร้อยแล้ว'
                                  : 'ยังไม่รับพัสดุ (รอรับ/ดำเนินการ)'}
                              </div>
                              {isReceived ? (
                                <div className="font-mono text-[11px] sm:text-xs font-bold text-emerald-800">
                                  วันที่รับพัสดุ:{' '}
                                  {formatThaiSlashDate(
                                    parcel.deliveredDate || parcel.receivedDate || parcel.updatedAt
                                  )}
                                </div>
                              ) : (
                                <div className="text-[11px] sm:text-xs">
                                  {isLegalHold
                                    ? 'กรุณาติดต่อห้องนิติการ/ครูหอพักตามระเบียบ'
                                    : isInfirmary
                                    ? 'กรุณาติดต่องานพยาบาลเพื่อรับพัสดุ'
                                    : hasDormitory
                                    ? `พัสดุจัดส่งไปยัง ${parcel.dormitory} (${dormTheme.basketCode}) แล้ว รอนักเรียนติดต่อรับ`
                                    : 'พัสดุลงทะเบียนเข้าสู่ระบบแล้ว รอนักเรียนติดต่อรับ'}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {parcel.note &&
                          parcel.note !== 'ส่งตรวจห้องนิติการ/ครูหอพักตามระเบียบ' && (
                            <div className="pt-1.5 border-t border-black/10 text-[11px] font-medium">
                              หมายเหตุ: {parcel.note}
                            </div>
                          )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
